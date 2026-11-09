// Joystick access through the GameController framework.

#import <Foundation/Foundation.h>
#import <GameController/GameController.h>

#include "hal.h"

static NSString *controllerID(GCController *c, NSUInteger index) {
    NSString *name = c.vendorName ?: @"gamepad";
    NSMutableString *clean = [NSMutableString string];
    for (NSUInteger i = 0; i < name.length; i++) {
        unichar ch = [name characterAtIndex:i];
        BOOL ok = (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9');
        [clean appendFormat:@"%C", ok ? ch : (unichar)'-'];
    }
    return [NSString stringWithFormat:@"%@-%lu", clean, (unsigned long)index];
}

void HalJoystickMainThread(void) {
    // Hydris runs without a window of its own, so it is never the focused app.
    GCController.shouldMonitorBackgroundEvents = YES;
    // A run loop without a source returns immediately.
    NSRunLoop *loop = NSRunLoop.currentRunLoop;
    [loop addPort:[NSMachPort port] forMode:NSDefaultRunLoopMode];
    for (;;) {
        @autoreleasepool {
            [loop runMode:NSDefaultRunLoopMode beforeDate:NSDate.distantFuture];
        }
    }
}

int32_t HalJoystickList(char *buf, int32_t n) {
    @autoreleasepool {
        NSMutableArray *list = [NSMutableArray array];
        NSArray<GCController *> *controllers = GCController.controllers;
        for (NSUInteger i = 0; i < controllers.count; i++) {
            GCController *c = controllers[i];
            if (c.extendedGamepad == nil) {
                continue;
            }
            [list addObject:@{
                @"ID" : controllerID(c, i),
                @"Name" : c.vendorName ?: @"Gamepad",
                @"Axes" : @8,
                @"Buttons" : @8,
            }];
        }
        NSData *json = [NSJSONSerialization dataWithJSONObject:list options:0 error:nil];
        if (json == nil || (int32_t)json.length > n) {
            return -1;
        }
        memcpy(buf, json.bytes, json.length);
        return (int32_t)json.length;
    }
}

// Axes and buttons use the layout documented on hal.JoystickState. Up is negative
// there, and positive in this framework.
int32_t HalJoystickRead(const char *jid, float *axes, uint8_t *buttons) {
    @autoreleasepool {
        NSString *wanted = [NSString stringWithUTF8String:jid];
        NSArray<GCController *> *controllers = GCController.controllers;
        for (NSUInteger i = 0; i < controllers.count; i++) {
            GCController *c = controllers[i];
            GCExtendedGamepad *g = c.extendedGamepad;
            if (g == nil || ![controllerID(c, i) isEqualToString:wanted]) {
                continue;
            }
            axes[0] = g.leftThumbstick.xAxis.value;
            axes[1] = -g.leftThumbstick.yAxis.value;
            axes[2] = g.leftTrigger.value * 2 - 1;
            axes[3] = g.rightThumbstick.xAxis.value;
            axes[4] = -g.rightThumbstick.yAxis.value;
            axes[5] = g.rightTrigger.value * 2 - 1;
            axes[6] = g.dpad.xAxis.value;
            axes[7] = -g.dpad.yAxis.value;
            buttons[0] = g.buttonA.pressed;
            buttons[1] = g.buttonB.pressed;
            buttons[2] = g.buttonX.pressed;
            buttons[3] = g.buttonY.pressed;
            buttons[4] = g.leftShoulder.pressed;
            buttons[5] = g.rightShoulder.pressed;
            buttons[6] = g.buttonOptions.pressed;
            buttons[7] = g.buttonMenu.pressed;
            return 0;
        }
        return -1;
    }
}
