/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "AppDelegate.h"

#import <React/RCTBridge.h>
#import <React/RCTBundleURLProvider.h>
#import <React/RCTRootView.h>

#import <BackgroundTasks/BackgroundTasks.h>
#include "Background.h"

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  RCTBridge *bridge = [[RCTBridge alloc] initWithDelegate:self launchOptions:launchOptions];
  RCTRootView *rootView = [[RCTRootView alloc] initWithBridge:bridge
                                                   moduleName:@"BleInTheBackground"
                                            initialProperties:nil];

  rootView.backgroundColor = [[UIColor alloc] initWithRed:1.0f green:1.0f blue:1.0f alpha:1];
  self.window = [[UIWindow alloc] initWithFrame:[UIScreen mainScreen].bounds];
  UIViewController *rootViewController = [UIViewController new];
  rootViewController.view = rootView;
  self.window.rootViewController = rootViewController;
  [self.window makeKeyAndVisible];
  
  [[BGTaskScheduler sharedScheduler] registerForTaskWithIdentifier:@"LongRunningTask" usingQueue:dispatch_get_main_queue() launchHandler:^(__kindof BGTask * _Nonnull task) {
    NSLog(@"Executing LongRunningTask...");
    id plxBackground = [bridge moduleForName:@"PLXBackground"];
    if (plxBackground != nil &&
        [plxBackground isKindOfClass:[PLXBackground class]] &&
        [task isKindOfClass:[BGProcessingTask class]]) {
      NSLog(@"Propagating task to a module...");
      [((PLXBackground*)plxBackground) backgroundTaskExecuting:task];
    } else {
      NSLog(@"Cannot propagate task to a module, aborting...");
      [task setTaskCompletedWithSuccess:true];
    }
  }];
  
  return YES;
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index" fallbackResource:nil];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

@end
