// BLE (CoreBluetooth) implementation for macOS HAL dylib.

#import <CoreBluetooth/CoreBluetooth.h>
#import <Foundation/Foundation.h>
#import "hal.h"

// From hal_serial.m
extern void hal_set_error(NSString *msg);

// Expand short BLE UUIDs (e.g. "2A24") to full 128-bit form, uppercased.
static NSString *hal_expand_uuid(NSString *uuid) {
    NSString *upper = uuid.uppercaseString;
    if (upper.length == 4) {
        return [NSString stringWithFormat:@"0000%@-0000-1000-8000-00805F9B34FB", upper];
    }
    if (upper.length == 8) {
        return [NSString stringWithFormat:@"%@-0000-1000-8000-00805F9B34FB", upper];
    }
    return upper;
}

// Watch handle map is in hal_serial.m
extern NSLock *_watchLock;
extern NSMutableDictionary<NSNumber *, id> *_watches;
extern int64_t _watchNextHandle;

// ---------------------------------------------------------------------------
// BLE Manager (singleton)
// ---------------------------------------------------------------------------

@interface HalBLEManager : NSObject <CBCentralManagerDelegate>
@property (nonatomic, strong) CBCentralManager *central;
@property (nonatomic, strong) dispatch_queue_t bleQueue;
@property (nonatomic, strong) NSLock *devLock;
@property (nonatomic, strong) NSMutableDictionary<NSString *, CBPeripheral *> *peripherals;
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSDictionary *> *deviceInfo;
@property (nonatomic, assign) BOOL ready;
@property (nonatomic, strong) dispatch_semaphore_t readySem;
@end

@implementation HalBLEManager

+ (instancetype)shared {
    static HalBLEManager *instance;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        instance = [[HalBLEManager alloc] init];
    });
    return instance;
}

- (instancetype)init {
    self = [super init];
    _bleQueue = dispatch_queue_create("hydris.ble", DISPATCH_QUEUE_SERIAL);
    _devLock = [[NSLock alloc] init];
    _peripherals = [NSMutableDictionary new];
    _deviceInfo = [NSMutableDictionary new];
    _readySem = dispatch_semaphore_create(0);
    _central = [[CBCentralManager alloc] initWithDelegate:self queue:_bleQueue];
    return self;
}

- (BOOL)waitReady {
    if (_ready) return YES;
    return dispatch_semaphore_wait(_readySem, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) == 0;
}

- (void)centralManagerDidUpdateState:(CBCentralManager *)central {
    if (central.state == CBManagerStatePoweredOn && !_ready) {
        _ready = YES;
        dispatch_semaphore_signal(_readySem);
    }
}

- (void)centralManager:(CBCentralManager *)central
  didDiscoverPeripheral:(CBPeripheral *)peripheral
      advertisementData:(NSDictionary<NSString *,id> *)ad
                   RSSI:(NSNumber *)RSSI {
    NSString *uuid = peripheral.identifier.UUIDString;
    NSString *name = peripheral.name ?: ad[CBAdvertisementDataLocalNameKey] ?: @"";
    NSMutableArray *uuids = [NSMutableArray new];
    for (CBUUID *u in ad[CBAdvertisementDataServiceUUIDsKey] ?: @[])
        [uuids addObject:u.UUIDString];

    NSDictionary *info = @{
        @"Address": uuid,
        @"Name": name,
        @"ServiceUUIDs": uuids,
        @"RSSI": RSSI,
    };

    [_devLock lock];
    _peripherals[uuid] = peripheral;
    _deviceInfo[uuid] = info;
    [_devLock unlock];
}

- (NSData *)snapshotJSON {
    [_devLock lock];
    NSArray *devices = _deviceInfo.allValues;
    [_devLock unlock];
    return [NSJSONSerialization dataWithJSONObject:devices options:0 error:nil];
}

- (CBPeripheral *)peripheralForAddress:(NSString *)addr {
    [_devLock lock];
    CBPeripheral *p = _peripherals[addr];
    [_devLock unlock];
    return p;
}

@end

// ---------------------------------------------------------------------------
// BLE Connection (per-peripheral)
// ---------------------------------------------------------------------------

@interface HalBLEConnection : NSObject <CBPeripheralDelegate>
@property (nonatomic, strong) CBPeripheral *peripheral;
@property (nonatomic, strong) NSMutableDictionary<NSString *, CBCharacteristic *> *chars;
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSValue *> *notifyCallbacks; // HalDataCallback

@property (nonatomic, copy) void (^disconnectCallback)(void);

@property (nonatomic, strong) dispatch_semaphore_t connectSem;
@property (nonatomic, strong) dispatch_semaphore_t serviceSem;
@property (nonatomic, strong) dispatch_semaphore_t charSem;
@property (nonatomic, assign) int pendingDiscoverCount;

@property (nonatomic, strong) NSString *serviceError;

@property (nonatomic, strong) dispatch_semaphore_t readSem;
@property (nonatomic, strong) NSData *readResult;
@property (nonatomic, strong) NSString *readError;

@property (nonatomic, strong) dispatch_semaphore_t writeSem;
@property (nonatomic, strong) NSString *writeError;
@end

@implementation HalBLEConnection

- (instancetype)initWithPeripheral:(CBPeripheral *)peripheral {
    self = [super init];
    _peripheral = peripheral;
    _chars = [NSMutableDictionary new];
    _notifyCallbacks = [NSMutableDictionary new];
    _connectSem = dispatch_semaphore_create(0);
    _serviceSem = dispatch_semaphore_create(0);
    _charSem = dispatch_semaphore_create(0);
    _readSem = dispatch_semaphore_create(0);
    _writeSem = dispatch_semaphore_create(0);
    peripheral.delegate = self;
    return self;
}

- (BOOL)connectWithError:(NSString **)error {
    [[HalBLEManager shared].central connectPeripheral:_peripheral options:nil];
    if (dispatch_semaphore_wait(_connectSem, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC)) != 0) {
        *error = @"connect timed out";
        return NO;
    }
    // Discover services
    [_peripheral discoverServices:nil];
    if (dispatch_semaphore_wait(_serviceSem, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC)) != 0) {
        *error = @"service discovery timed out";
        return NO;
    }
    if (_serviceError) {
        *error = _serviceError;
        return NO;
    }

    NSArray<CBService *> *services = _peripheral.services ?: @[];
    // Discover characteristics for each service
    _pendingDiscoverCount = (int)services.count;
    if (_pendingDiscoverCount > 0) {
        for (CBService *svc in services)
            [_peripheral discoverCharacteristics:nil forService:svc];
        if (dispatch_semaphore_wait(_charSem, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC)) != 0) {
            *error = @"characteristic discovery timed out";
            return NO;
        }
    }

    return YES;
}

- (void)disconnect {
    [[HalBLEManager shared].central cancelPeripheralConnection:_peripheral];
}

// CBPeripheralDelegate

- (void)peripheral:(CBPeripheral *)peripheral didDiscoverServices:(NSError *)error {
    if (error) _serviceError = error.localizedDescription;
    dispatch_semaphore_signal(_serviceSem);
}

- (void)peripheral:(CBPeripheral *)peripheral didDiscoverCharacteristicsForService:(CBService *)service error:(NSError *)error {
    for (CBCharacteristic *c in service.characteristics)
        _chars[hal_expand_uuid(c.UUID.UUIDString)] = c;
    _pendingDiscoverCount--;
    if (_pendingDiscoverCount <= 0)
        dispatch_semaphore_signal(_charSem);
}

- (void)peripheral:(CBPeripheral *)peripheral didUpdateValueForCharacteristic:(CBCharacteristic *)characteristic error:(NSError *)error {
    NSString *key = characteristic.UUID.UUIDString.uppercaseString;

    // Check if this is a notification
    NSValue *cbVal = _notifyCallbacks[key];
    if (cbVal && characteristic.isNotifying) {
        HalDataCallback cb;
        [cbVal getValue:&cb];
        NSData *data = characteristic.value;
        if (data) cb((const uint8_t *)data.bytes, (int32_t)data.length);
        return;
    }

    // Read response
    if (error) {
        _readError = error.localizedDescription;
    } else {
        _readResult = characteristic.value;
    }
    dispatch_semaphore_signal(_readSem);
}

- (void)peripheral:(CBPeripheral *)peripheral didWriteValueForCharacteristic:(CBCharacteristic *)characteristic error:(NSError *)error {
    if (error) _writeError = error.localizedDescription;
    dispatch_semaphore_signal(_writeSem);
}

@end

// Connect/disconnect delegate methods on the manager
@interface HalBLEManager (Connection)
@end

// We need to find the connection object for a given peripheral to signal its semaphore.
// Use a global map.
static NSLock *_connLock;
static NSMutableDictionary<NSNumber *, HalBLEConnection *> *_bleConns;
static int64_t _bleNextHandle = 1;

__attribute__((constructor))
static void hal_init_ble(void) {
    _connLock = [[NSLock alloc] init];
    _bleConns = [NSMutableDictionary new];
}

@implementation HalBLEManager (Connection)

- (void)centralManager:(CBCentralManager *)central didConnectPeripheral:(CBPeripheral *)peripheral {
    [_connLock lock];
    for (HalBLEConnection *conn in _bleConns.allValues) {
        if (conn.peripheral == peripheral) {
            dispatch_semaphore_signal(conn.connectSem);
            break;
        }
    }
    [_connLock unlock];
}

- (void)centralManager:(CBCentralManager *)central didFailToConnectPeripheral:(CBPeripheral *)peripheral error:(NSError *)error {
    [_connLock lock];
    for (HalBLEConnection *conn in _bleConns.allValues) {
        if (conn.peripheral == peripheral) {
            dispatch_semaphore_signal(conn.connectSem);
            break;
        }
    }
    [_connLock unlock];
}

- (void)centralManager:(CBCentralManager *)central didDisconnectPeripheral:(CBPeripheral *)peripheral error:(NSError *)error {
    void (^cb)(void) = nil;
    [_connLock lock];
    for (NSNumber *key in _bleConns) {
        HalBLEConnection *conn = _bleConns[key];
        if (conn.peripheral == peripheral) {
            cb = conn.disconnectCallback;
            [_bleConns removeObjectForKey:key];
            break;
        }
    }
    [_connLock unlock];
    if (cb) cb();
}

@end

// ---------------------------------------------------------------------------
// Exported C functions — BLE
// ---------------------------------------------------------------------------

uintptr_t HalBleWatch(HalDataCallback cb) {
    HalBLEManager *mgr = [HalBLEManager shared];
    if (![mgr waitReady]) return 0;

    dispatch_source_t timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, mgr.bleQueue);
    dispatch_source_set_timer(timer, dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC),
                              3 * NSEC_PER_SEC, 1 * NSEC_PER_SEC);
    dispatch_source_set_event_handler(timer, ^{
        NSData *json = [mgr snapshotJSON];
        if (json) cb((const uint8_t *)json.bytes, (int32_t)json.length);
    });
    dispatch_resume(timer);

    [mgr.central scanForPeripheralsWithServices:nil options:@{
        CBCentralManagerScanOptionAllowDuplicatesKey: @YES,
    }];

    // Store a stop block in the watch map
    void (^stopBlock)(void) = ^{
        dispatch_source_cancel(timer);
        [mgr.central stopScan];
    };

    [_watchLock lock];
    int64_t handle = _watchNextHandle++;
    _watches[@(handle)] = [stopBlock copy];
    [_watchLock unlock];

    return (uintptr_t)handle;
}

int64_t HalBleConnect(const char *address) {
    NSString *addr = [[NSString stringWithUTF8String:address] uppercaseString];
    HalBLEManager *mgr = [HalBLEManager shared];
    if (![mgr waitReady]) {
        hal_set_error(@"BLE not ready");
        return 0;
    }

    // Try the discovery cache first.
    CBPeripheral *peripheral = [mgr peripheralForAddress:addr];

    // Ask CoreBluetooth for previously-known peripherals.
    if (!peripheral) {
        NSUUID *nsuuid = [[NSUUID alloc] initWithUUIDString:addr];
        if (nsuuid) {
            NSArray<CBPeripheral *> *known = [mgr.central retrievePeripheralsWithIdentifiers:@[nsuuid]];
            if (known.count > 0) peripheral = known[0];
        }
    }

    // Still not found — wait for an active scan to discover it (up to 10s).
    if (!peripheral) {
        NSUUID *target = [[NSUUID alloc] initWithUUIDString:addr];
        if (target) {
            for (int i = 0; i < 20 && !peripheral; i++) {
                [NSThread sleepForTimeInterval:0.5];
                peripheral = [mgr peripheralForAddress:addr];
            }
        }
    }

    if (!peripheral) {
        hal_set_error([NSString stringWithFormat:@"peripheral %@ not found", addr]);
        return 0;
    }

    HalBLEConnection *conn = [[HalBLEConnection alloc] initWithPeripheral:peripheral];

    [_connLock lock];
    int64_t handle = _bleNextHandle++;
    _bleConns[@(handle)] = conn;
    [_connLock unlock];

    NSString *error = nil;
    if (![conn connectWithError:&error]) {
        [_connLock lock];
        [_bleConns removeObjectForKey:@(handle)];
        [_connLock unlock];
        hal_set_error(error ?: @"connect failed");
        return 0;
    }
    return handle;
}

int32_t HalBleDisconnect(int64_t handle) {
    [_connLock lock];
    HalBLEConnection *conn = _bleConns[@(handle)];
    [_bleConns removeObjectForKey:@(handle)];
    [_connLock unlock];
    if (!conn) { hal_set_error(@"unknown BLE handle"); return -1; }
    [conn disconnect];
    return 0;
}

static HalBLEConnection *getConn(int64_t handle) {
    [_connLock lock];
    HalBLEConnection *conn = _bleConns[@(handle)];
    [_connLock unlock];
    return conn;
}

void HalBleOnDisconnect(int64_t handle, void (*cb)(void)) {
    HalBLEConnection *conn = getConn(handle);
    if (!conn) return;
    conn.disconnectCallback = ^{ cb(); };
}

int32_t HalBleRead(int64_t handle, const char *charUUID, uint8_t *buf, int32_t n) {
    HalBLEConnection *conn = getConn(handle);
    if (!conn) { hal_set_error(@"unknown BLE handle"); return -1; }

    NSString *key = [[NSString stringWithUTF8String:charUUID] uppercaseString];
    CBCharacteristic *c = conn.chars[key];
    if (!c) {
        hal_set_error([NSString stringWithFormat:@"characteristic %s not found", charUUID]);
        return -1;
    }

    conn.readResult = nil;
    conn.readError = nil;
    [conn.peripheral readValueForCharacteristic:c];

    if (dispatch_semaphore_wait(conn.readSem, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) != 0) {
        hal_set_error(@"read timed out");
        return -1;
    }
    if (conn.readError) { hal_set_error(conn.readError); return -1; }
    if (!conn.readResult) { hal_set_error(@"read returned no data"); return -1; }

    int32_t count = (int32_t)MIN(conn.readResult.length, (NSUInteger)n);
    memcpy(buf, conn.readResult.bytes, count);
    return count;
}

int32_t HalBleWrite(int64_t handle, const char *charUUID, const uint8_t *data, int32_t n) {
    HalBLEConnection *conn = getConn(handle);
    if (!conn) { hal_set_error(@"unknown BLE handle"); return -1; }

    NSString *key = [[NSString stringWithUTF8String:charUUID] uppercaseString];
    CBCharacteristic *c = conn.chars[key];
    if (!c) {
        hal_set_error([NSString stringWithFormat:@"characteristic %s not found", charUUID]);
        return -1;
    }

    conn.writeError = nil;
    NSData *payload = [NSData dataWithBytes:data length:n];
    [conn.peripheral writeValue:payload forCharacteristic:c type:CBCharacteristicWriteWithResponse];

    if (dispatch_semaphore_wait(conn.writeSem, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) != 0) {
        hal_set_error(@"write timed out");
        return -1;
    }
    if (conn.writeError) { hal_set_error(conn.writeError); return -1; }
    return 0;
}

int32_t HalBleSubscribe(int64_t handle, const char *charUUID, HalDataCallback cb) {
    HalBLEConnection *conn = getConn(handle);
    if (!conn) { hal_set_error(@"unknown BLE handle"); return -1; }

    NSString *key = [[NSString stringWithUTF8String:charUUID] uppercaseString];
    CBCharacteristic *c = conn.chars[key];
    if (!c) {
        hal_set_error([NSString stringWithFormat:@"characteristic %s not found", charUUID]);
        return -1;
    }

    NSValue *cbVal = [NSValue valueWithBytes:&cb objCType:@encode(HalDataCallback)];
    conn.notifyCallbacks[key] = cbVal;
    [conn.peripheral setNotifyValue:YES forCharacteristic:c];
    return 0;
}

int32_t HalBleUnsubscribe(int64_t handle, const char *charUUID) {
    HalBLEConnection *conn = getConn(handle);
    if (!conn) { hal_set_error(@"unknown BLE handle"); return -1; }

    NSString *key = [[NSString stringWithUTF8String:charUUID] uppercaseString];
    CBCharacteristic *c = conn.chars[key];
    if (!c) {
        hal_set_error([NSString stringWithFormat:@"characteristic %s not found", charUUID]);
        return -1;
    }

    [conn.notifyCallbacks removeObjectForKey:key];
    [conn.peripheral setNotifyValue:NO forCharacteristic:c];
    return 0;
}

int32_t HalBleServices(int64_t handle, uint8_t *buf, int32_t n) {
    HalBLEConnection *conn = getConn(handle);
    if (!conn) { hal_set_error(@"unknown BLE handle"); return -1; }

    NSMutableArray *result = [NSMutableArray new];
    for (CBService *svc in conn.peripheral.services ?: @[]) {
        NSMutableArray *charUUIDs = [NSMutableArray new];
        for (CBCharacteristic *c in svc.characteristics ?: @[])
            [charUUIDs addObject:hal_expand_uuid(c.UUID.UUIDString)];
        [result addObject:@{
            @"UUID": hal_expand_uuid(svc.UUID.UUIDString),
            @"CharacteristicUUIDs": charUUIDs,
        }];
    }

    NSData *json = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
    if (!json) { hal_set_error(@"JSON encoding failed"); return -1; }

    int32_t count = (int32_t)MIN(json.length, (NSUInteger)n);
    memcpy(buf, json.bytes, count);
    return count;
}
