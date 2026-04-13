// Serial port discovery (IOKit) and I/O (POSIX) for macOS.

#import <Foundation/Foundation.h>
#import <IOKit/IOKitLib.h>
#import <IOKit/serial/IOSerialKeys.h>
#import <IOKit/usb/IOUSBLib.h>
#import <sys/ioctl.h>
#import <termios.h>
#import "hal.h"

// ---------------------------------------------------------------------------
// Error handling (shared with hal_ble.m)
// ---------------------------------------------------------------------------

static NSLock *_errorLock;
static NSString *_lastError;

__attribute__((constructor))
static void hal_init_error(void) {
    _errorLock = [[NSLock alloc] init];
}

void hal_set_error(NSString *msg) {
    [_errorLock lock];
    _lastError = [msg copy];
    [_errorLock unlock];
}

int32_t HalGetError(uint8_t *buf, int32_t n) {
    [_errorLock lock];
    NSString *err = _lastError;
    _lastError = nil;
    [_errorLock unlock];

    if (!err) return 0;
    NSData *utf8 = [err dataUsingEncoding:NSUTF8StringEncoding];
    int32_t count = (int32_t)MIN(utf8.length, (NSUInteger)n);
    memcpy(buf, utf8.bytes, count);
    return count;
}

// ---------------------------------------------------------------------------
// Handle maps
// ---------------------------------------------------------------------------

static NSLock *_serialLock;
static NSMutableDictionary<NSNumber *, NSNumber *> *_serialFDs;  // handle -> fd
static int64_t _serialNextHandle = 1;

NSLock *_watchLock;
NSMutableDictionary<NSNumber *, id> *_watches;  // handle -> watcher block/object
int64_t _watchNextHandle = 1;

__attribute__((constructor))
static void hal_init_serial(void) {
    _serialLock = [[NSLock alloc] init];
    _serialFDs = [NSMutableDictionary new];
    _watchLock = [[NSLock alloc] init];
    _watches = [NSMutableDictionary new];
}

// ---------------------------------------------------------------------------
// Serial discovery via IOKit
// ---------------------------------------------------------------------------

static NSData *scanSerialPortsJSON(void) {
    NSMutableArray *ports = [NSMutableArray new];

    io_iterator_t iter = 0;
    CFMutableDictionaryRef matching = IOServiceMatching(kIOSerialBSDServiceValue);
    if (IOServiceGetMatchingServices(kIOMainPortDefault, matching, &iter) != KERN_SUCCESS)
        return [NSJSONSerialization dataWithJSONObject:ports options:0 error:nil];

    io_object_t service;
    while ((service = IOIteratorNext(iter)) != 0) {
        CFTypeRef pathCF = IORegistryEntryCreateCFProperty(service, CFSTR(kIOCalloutDeviceKey), kCFAllocatorDefault, 0);
        if (!pathCF) { IOObjectRelease(service); continue; }

        NSString *path = (__bridge_transfer NSString *)pathCF;
        if (![path hasPrefix:@"/dev/cu."]) { IOObjectRelease(service); continue; }

        NSMutableDictionary *info = [NSMutableDictionary new];
        info[@"Path"] = path;
        info[@"StablePath"] = path;
        info[@"Name"] = [path lastPathComponent];
        info[@"Key"] = @"";
        info[@"VendorID"] = @0;
        info[@"ProductID"] = @0;
        info[@"SerialNumber"] = @"";
        info[@"ManufacturerName"] = @"";
        info[@"ProductName"] = @"";

        // Walk up IOKit tree to find USB properties
        io_object_t parent = service;
        IOObjectRetain(parent);
        for (int i = 0; i < 8; i++) {
            CFTypeRef vid = IORegistryEntryCreateCFProperty(parent, CFSTR("idVendor"), kCFAllocatorDefault, 0);
            if (vid) {
                info[@"VendorID"] = (__bridge_transfer NSNumber *)vid;

                CFTypeRef pid = IORegistryEntryCreateCFProperty(parent, CFSTR("idProduct"), kCFAllocatorDefault, 0);
                if (pid) info[@"ProductID"] = (__bridge_transfer NSNumber *)pid;

                CFTypeRef sn = IORegistryEntryCreateCFProperty(parent, CFSTR("USB Serial Number"), kCFAllocatorDefault, 0);
                if (sn) info[@"SerialNumber"] = (__bridge_transfer NSString *)sn;

                CFTypeRef mfr = IORegistryEntryCreateCFProperty(parent, CFSTR("USB Vendor Name"), kCFAllocatorDefault, 0);
                if (mfr) info[@"ManufacturerName"] = (__bridge_transfer NSString *)mfr;

                CFTypeRef prod = IORegistryEntryCreateCFProperty(parent, CFSTR("USB Product Name"), kCFAllocatorDefault, 0);
                if (prod) {
                    info[@"ProductName"] = (__bridge_transfer NSString *)prod;
                    info[@"Name"] = info[@"ProductName"];
                }

                NSString *sn2 = info[@"SerialNumber"];
                if (sn2.length > 0) {
                    info[@"Key"] = [NSString stringWithFormat:@"%@:%@:%@",
                                    info[@"VendorID"], info[@"ProductID"], sn2];
                }
                IOObjectRelease(parent);
                goto done;
            }
            io_object_t next = 0;
            if (IORegistryEntryGetParentEntry(parent, kIOServicePlane, &next) != KERN_SUCCESS) {
                IOObjectRelease(parent);
                break;
            }
            IOObjectRelease(parent);
            parent = next;
        }
done:
        [ports addObject:info];
        IOObjectRelease(service);
    }
    IOObjectRelease(iter);

    return [NSJSONSerialization dataWithJSONObject:ports options:0 error:nil];
}

// Watcher state
@interface HalSerialWatcher : NSObject {
    HalDataCallback _cb;
    IONotificationPortRef _notifyPort;
    io_iterator_t _addIter;
    io_iterator_t _removeIter;
    BOOL _stopped;
}
@end

@implementation HalSerialWatcher

- (instancetype)initWithCallback:(HalDataCallback)cb {
    self = [super init];
    _cb = cb;
    _stopped = NO;

    _notifyPort = IONotificationPortCreate(kIOMainPortDefault);
    if (!_notifyPort) return self;

    dispatch_queue_t q = dispatch_queue_create("hydris.serial.watch", DISPATCH_QUEUE_SERIAL);
    IONotificationPortSetDispatchQueue(_notifyPort, q);

    // Add notification
    CFMutableDictionaryRef addMatch = IOServiceMatching(kIOSerialBSDServiceValue);
    CFRetain(addMatch);  // IOServiceAddMatchingNotification consumes one
    IOServiceAddMatchingNotification(_notifyPort, kIOFirstMatchNotification, addMatch,
        hal_serial_notify, (__bridge void *)self, &_addIter);
    while (IOIteratorNext(_addIter)) {}  // drain

    // Remove notification
    CFMutableDictionaryRef removeMatch = IOServiceMatching(kIOSerialBSDServiceValue);
    CFRetain(removeMatch);
    IOServiceAddMatchingNotification(_notifyPort, kIOTerminatedNotification, removeMatch,
        hal_serial_notify, (__bridge void *)self, &_removeIter);
    while (IOIteratorNext(_removeIter)) {}  // drain

    [self sendSnapshot];
    return self;
}

- (void)sendSnapshot {
    if (_stopped) return;
    NSData *json = scanSerialPortsJSON();
    if (json) _cb((const uint8_t *)json.bytes, (int32_t)json.length);
}

- (void)stop {
    _stopped = YES;
    if (_addIter) { IOObjectRelease(_addIter); _addIter = 0; }
    if (_removeIter) { IOObjectRelease(_removeIter); _removeIter = 0; }
    if (_notifyPort) { IONotificationPortDestroy(_notifyPort); _notifyPort = nil; }
}

static void hal_serial_notify(void *refcon, io_iterator_t iterator) {
    while (IOIteratorNext(iterator)) {}  // drain
    HalSerialWatcher *w = (__bridge HalSerialWatcher *)refcon;
    [w sendSnapshot];
}

@end

// ---------------------------------------------------------------------------
// Exported C functions — Serial
// ---------------------------------------------------------------------------

uintptr_t HalSerialWatch(HalDataCallback cb) {
    HalSerialWatcher *w = [[HalSerialWatcher alloc] initWithCallback:cb];
    [_watchLock lock];
    int64_t handle = _watchNextHandle++;
    _watches[@(handle)] = w;
    [_watchLock unlock];
    return (uintptr_t)handle;
}

void HalStopWatch(uintptr_t handle) {
    [_watchLock lock];
    id obj = _watches[@((int64_t)handle)];
    [_watches removeObjectForKey:@((int64_t)handle)];
    [_watchLock unlock];

    if ([obj isKindOfClass:[HalSerialWatcher class]])
        [(HalSerialWatcher *)obj stop];
    // BLE watcher stop is a block — see hal_ble.m
    if ([obj isKindOfClass:NSClassFromString(@"NSBlock")])
        ((void(^)(void))obj)();
}

static speed_t baud_to_speed(int32_t baud) {
    switch (baud) {
        case 300:    return B300;
        case 1200:   return B1200;
        case 2400:   return B2400;
        case 4800:   return B4800;
        case 9600:   return B9600;
        case 19200:  return B19200;
        case 38400:  return B38400;
        case 57600:  return B57600;
        case 115200: return B115200;
        case 230400: return B230400;
        default:     return 0;
    }
}

int64_t HalSerialOpen(const char *path, int32_t baud) {
    int fd = open(path, O_RDWR | O_NOCTTY | O_NONBLOCK);
    if (fd < 0) {
        hal_set_error([NSString stringWithFormat:@"%s", strerror(errno)]);
        return 0;
    }

    struct termios opts;
    tcgetattr(fd, &opts);
    cfmakeraw(&opts);

    speed_t speed = baud_to_speed(baud);
    if (speed) {
        cfsetispeed(&opts, speed);
        cfsetospeed(&opts, speed);
    }

    opts.c_cc[VMIN] = 1;
    opts.c_cc[VTIME] = 0;
    tcsetattr(fd, TCSANOW, &opts);

    // Non-standard baud rates via IOSSIOSPEED
    if (!speed) {
        unsigned long rate = (unsigned long)baud;
        if (ioctl(fd, _IOW('T', 2, speed_t), &rate) != 0) {
            hal_set_error([NSString stringWithFormat:@"IOSSIOSPEED: %s", strerror(errno)]);
            close(fd);
            return 0;
        }
    }

    // Clear non-blocking
    int flags = fcntl(fd, F_GETFL);
    fcntl(fd, F_SETFL, flags & ~O_NONBLOCK);

    [_serialLock lock];
    int64_t handle = _serialNextHandle++;
    _serialFDs[@(handle)] = @(fd);
    [_serialLock unlock];

    return handle;
}

int32_t HalSerialRead(int64_t handle, uint8_t *buf, int32_t n) {
    [_serialLock lock];
    NSNumber *fdNum = _serialFDs[@(handle)];
    [_serialLock unlock];
    if (!fdNum) { hal_set_error(@"unknown serial handle"); return -1; }

    ssize_t r = read(fdNum.intValue, buf, n);
    if (r < 0) { hal_set_error([NSString stringWithFormat:@"%s", strerror(errno)]); return -1; }
    return (int32_t)r;
}

int32_t HalSerialWrite(int64_t handle, const uint8_t *buf, int32_t n) {
    [_serialLock lock];
    NSNumber *fdNum = _serialFDs[@(handle)];
    [_serialLock unlock];
    if (!fdNum) { hal_set_error(@"unknown serial handle"); return -1; }

    ssize_t w = write(fdNum.intValue, buf, n);
    if (w < 0) { hal_set_error([NSString stringWithFormat:@"%s", strerror(errno)]); return -1; }
    return (int32_t)w;
}

int32_t HalSerialClose(int64_t handle) {
    [_serialLock lock];
    NSNumber *fdNum = _serialFDs[@(handle)];
    [_serialFDs removeObjectForKey:@(handle)];
    [_serialLock unlock];
    if (!fdNum) { hal_set_error(@"unknown serial handle"); return -1; }

    close(fdNum.intValue);
    return 0;
}
