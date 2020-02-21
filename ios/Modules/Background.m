//
//  Background.m
//  BleInTheBackground
//
//  Created by Przemysław Lenart on 18/02/2020.
//  Copyright © 2020 Polidea. All rights reserved.
//

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#include "Background.h"

NSString* BackgroundTaskExpiredEvent = @"BackgroundTaskExpired";
NSString* BackgroundProcessingExecutingEvent = @"BackgroundProcessingExecuting";
NSString* BackgroundProcessingExpiredEvent = @"BackgroundProcessingExpired";

@implementation PLXBackground
{
  NSMutableDictionary<NSString*, dispatch_block_t> *pendingTimers;
  NSMutableDictionary<NSString*, NSNumber*> *pendingBackgroundTasks;
  NSMutableDictionary<NSString*, BGProcessingTask*> *executingTasks;
  bool hasListeners;
}

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
  return true;
}

- (instancetype)init
{
  self = [super init];
  if (self) {
    self->pendingTimers = [NSMutableDictionary new];
    self->pendingBackgroundTasks = [NSMutableDictionary new];
    self->executingTasks = [NSMutableDictionary new];
    self->hasListeners = false;
  }
  return self;
}

- (void)startObserving {
  self->hasListeners = true;
}

- (void)stopObserving {
  self->hasListeners = false;
}

- (NSArray<NSString *> *)supportedEvents {
  return @[BackgroundTaskExpiredEvent, BackgroundProcessingExecutingEvent, BackgroundProcessingExpiredEvent];
}

- (void)backgroundTaskExecuting:(BGProcessingTask*)task {
  NSString* identifier = [task identifier];
  
  NSLog(@"Background task executing: %@", identifier);
  if (self->hasListeners) {
    // Setup expiration handler...
    [task setExpirationHandler:^(){
      if (self->hasListeners) {
        [self sendEventWithName:BackgroundProcessingExpiredEvent body:@{@"taskName": identifier}];
      } else {
        NSLog(@"No listeners to handle expiration. Aborting.");
        BGProcessingTask* task = [self->executingTasks objectForKey:identifier];
        if (task != nil) {
          [self->executingTasks removeObjectForKey:identifier];
          [task setTaskCompletedWithSuccess:true];
        }
      }
    }];
    
    // Inform about execution...
    [executingTasks setValue:task forKey:identifier];
    [self sendEventWithName:BackgroundProcessingExecutingEvent body:@{ @"taskName": identifier }];
  } else {
    NSLog(@"No listeners to handle task execution. Aborting.");
    [task setTaskCompletedWithSuccess:true];
  }
}

RCT_EXPORT_METHOD(setTimeout:(nonnull NSNumber*)timeout
                  timeoutId:(NSString *)timeoutId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  NSLog(@"Started timeout nr %@ for %@", timeoutId, timeout);
  dispatch_block_t work = dispatch_block_create(0, ^{
    NSLog(@"Got timeout nr %@", timeoutId);
    [self->pendingTimers removeObjectForKey:timeoutId];
    resolve(timeoutId);
  });
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, ([timeout doubleValue] * NSEC_PER_MSEC)), dispatch_get_main_queue(), work);
  [self->pendingTimers setValue:work forKey:timeoutId];
}

RCT_EXPORT_METHOD(clearTimeout:(NSString *)timeoutId)
{
  NSLog(@"Cleared timeout nr %@", timeoutId);
  dispatch_block_t block = [self->pendingTimers objectForKey:timeoutId];
  if (block != nil) {
    dispatch_block_cancel(block);
    [self->pendingTimers removeObjectForKey:timeoutId];
  }
}

RCT_EXPORT_METHOD(startBackgroundTask:(NSString*)taskName
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  UIBackgroundTaskIdentifier identifier = [[UIApplication sharedApplication] beginBackgroundTaskWithName:taskName expirationHandler:^{
    NSLog(@"Background task %@ expired", taskName);
    NSNumber* taskId = [self->pendingBackgroundTasks objectForKey:taskName];
    if (taskId != nil) {
      if (self->hasListeners) {
        [self sendEventWithName:BackgroundTaskExpiredEvent body:@{
          @"taskName": taskName
        }];
      } else {
        NSLog(@"Automatically ending background task %@", taskName);
        [[UIApplication sharedApplication] endBackgroundTask:[taskId unsignedIntegerValue]];
        [self->pendingBackgroundTasks removeObjectForKey:taskName];
      }
    }
  }];
  
  if (identifier == UIBackgroundTaskInvalid) {
    NSLog(@"Failed to start background task %@", taskName);
    reject(@"PLXBackground", [NSMutableString stringWithFormat:@"Cannot start background task with id: %@", taskName], nil);
    return;
  }
  
  NSLog(@"Started background task %@ with id: %lu", taskName, (unsigned long)identifier);
  [self->pendingBackgroundTasks setValue:@(identifier) forKey:taskName];
  resolve(taskName);
}

RCT_EXPORT_METHOD(endBackgroundTask:(NSString*)taskName) {
  NSLog(@"Ending background task %@", taskName);
  NSNumber* taskId = [self->pendingBackgroundTasks objectForKey:taskName];
  if (taskId != nil) {
    [[UIApplication sharedApplication] endBackgroundTask:[taskId unsignedIntegerValue]];
    [self->pendingBackgroundTasks removeObjectForKey:taskName];
  }
}

RCT_EXPORT_METHOD(completeBackgroundProcessing:(NSString*)taskName
                                        result:(BOOL)result) {
  NSLog(@"Finished background processing with result: %d", result);
  BGProcessingTask* task = [self->executingTasks objectForKey:taskName];
  if (task != nil) {
    [self->executingTasks removeObjectForKey:taskName];
    [task setTaskCompletedWithSuccess:result];
  }
}

RCT_EXPORT_METHOD(scheduleBackgroundProcessing:(NSString*)taskName
                                       timeout:(nonnull NSNumber*)timeoutMs
                                      resolver:(RCTPromiseResolveBlock)resolve
                                      rejecter:(RCTPromiseRejectBlock)reject) {
  BGTaskRequest *taskRequest = [[BGProcessingTaskRequest alloc] initWithIdentifier:taskName];
  [taskRequest setEarliestBeginDate:[NSDate dateWithTimeIntervalSinceNow:[timeoutMs doubleValue] / 1000.0]];
  if ([[BGTaskScheduler sharedScheduler] submitTaskRequest:taskRequest error:nil]) {
    resolve(taskName);
  } else {
    reject(@"PLXBackground", [NSString stringWithFormat:@"Cannot schedule task: '%@' with timeout: %@", taskName, timeoutMs], nil);
  }
}

RCT_EXPORT_METHOD(cancelBackgroundProcess:(NSString*)taskName) {
  [[BGTaskScheduler sharedScheduler] cancelTaskRequestWithIdentifier:taskName];
}

RCT_EXPORT_METHOD(cancelAllScheduledBackgroundProcesses) {
  [[BGTaskScheduler sharedScheduler] cancelAllTaskRequests];
}

@synthesize description;

@synthesize hash;

@synthesize superclass;

@end

