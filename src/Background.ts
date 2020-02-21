import {
  NativeModules,
  NativeEventEmitter,
  EventSubscriptionVendor,
} from 'react-native';

/**
 * Interface for a background module.
 */
interface PLXBackgroundInterface extends EventSubscriptionVendor {
  /**
   * Create a timer.
   * @param timeout   Time after timer resolves.
   * @param timeoutId Timer identifier.
   */
  setTimeout(timeout: number, timeoutId: string): Promise<string>;

  /**
   * Clear a timer.
   * @param timeoutId Timer identifier.
   */
  clearTimeout(timeoutId: string): void;

  /**
   * Mark the begining of a background task.
   * @param taskName Task name.
   */
  startBackgroundTask(taskName: string): Promise<string>;

  /**
   * Mark the end of background task.
   * @param taskName Task name.
   */
  endBackgroundTask(taskName: string): void;

  /**
   * Marks background processing task as completed.
   * @param taskName Task name identifier.
   * @param result   True if task completed successfully
   */
  completeBackgroundProcessing(taskName: string, result: boolean): void;

  /**
   * Schedule task number of milliseconds into the future. There is no guarantee
   * that task will execute exactly in specified time.
   * @param taskName Task name identifier.
   * @param timeout  Timeout in milliseconds.
   */
  scheduleBackgroundProcessing(
    taskName: string,
    timeout: number,
  ): Promise<string>;

  /**
   * Cancel background processing task.
   * @param taskName Task name identifier.
   */
  cancelBackgroundProcess(taskName: string): void;

  /**
   * Cancel all background processing tasks.
   */
  cancelAllScheduledBackgroundProcesses(): void;
}

// Events emitted by PLXBackground module.
const BackgroundTaskExpired = 'BackgroundTaskExpired';
const BackgroundProcessingExecuting = 'BackgroundProcessingExecuting';
const BackgroundProcessingExpired = 'BackgroundProcessingExpired';

interface BackgroundTaskExpiredEvent {
  taskName: string;
}
interface BackgroundProcessingExecutingEvent {
  taskName: string;
}
interface BackgroundProcessingExpiredEvent {
  taskName: string;
}

// Getting handles to background module and its event emitter.
const PLXBackground: PLXBackgroundInterface = NativeModules.PLXBackground;
if (PLXBackground == null) {
  console.error('PLXBackground is not defined!');
}
const PLXEventEmitter = new NativeEventEmitter(PLXBackground);

// Timers identifiers.
let nextTimeoutId = 0;

/**
 * Create a timer.
 * @param callback Callback invoked when timer fires.
 * @param timeout  Time after which timer fires.
 */
const setTimeout = (callback: () => void, timeout: number) => {
  const timeoutId = nextTimeoutId++;
  PLXBackground.setTimeout(timeout, timeoutId.toString()).then(() => {
    callback();
  });
  return timeoutId;
};

/**
 * Clears timer with specified id.
 * @param timeoutId Timer ID.
 */
const clearTimeout = (timeoutId: number) => {
  PLXBackground.clearTimeout(timeoutId.toString());
};

/**
 * Starts background task.
 * @param taskName        Name of a task
 * @param expiredCallback Callback invoked when task expired. User should call
 *                        `endBackgroundTask` as soon as possible.
 */
const startBackgroundTask = async (
  taskName: string,
  expiredCallback: (taskName: string) => void,
) => {
  const listener = (event: BackgroundTaskExpiredEvent) => {
    if (event.taskName === taskName) {
      expiredCallback(event.taskName);
      PLXEventEmitter.removeListener(BackgroundTaskExpired, listener);
    }
  };

  try {
    PLXEventEmitter.addListener(BackgroundTaskExpired, listener);
    await PLXBackground.startBackgroundTask(taskName);
  } catch {
    PLXEventEmitter.removeListener(BackgroundTaskExpired, listener);
  }
  return taskName;
};

let registeredCallbacks: {
  [taskName: string]: {
    execution: (event: BackgroundProcessingExecutingEvent) => void;
    expired: (event: BackgroundProcessingExpiredEvent) => void;
  };
} = {};

/**
 *
 * @param taskName              Task name to execute.
 * @param timeout               Timeout in millisecond after which task executes.
 * @param taskExecutionCallback Callback invoked when task execution started.
 * @param taskExpiredCallback   Callback invoked when task execution expired.
 */
const scheduleBackgroundProcessingTask = async (
  taskName: string,
  timeout: number,
  taskExecutionCallback: (taskName: string) => void,
  taskExpiredCallback: (taskName: string) => void,
) => {
  const executingCallback = (event: BackgroundProcessingExecutingEvent) => {
    taskExecutionCallback(event.taskName);
  };
  const expiredCallback = (event: BackgroundProcessingExpiredEvent) => {
    taskExpiredCallback(event.taskName);
  };
  PLXEventEmitter.addListener(BackgroundProcessingExecuting, executingCallback);
  PLXEventEmitter.addListener(BackgroundProcessingExpired, expiredCallback);

  try {
    await PLXBackground.scheduleBackgroundProcessing(taskName, timeout);
    registeredCallbacks[taskName] = {
      execution: executingCallback,
      expired: expiredCallback,
    };
  } catch (error) {
    PLXEventEmitter.removeListener(
      BackgroundProcessingExecuting,
      executingCallback,
    );
    PLXEventEmitter.removeListener(
      BackgroundProcessingExpired,
      expiredCallback,
    );
    throw error;
  }
};

/**
 * Mark background processing task as completed.
 * @param taskName Task name.
 * @param result   True if task completed successfully
 */
const completeBackgroundProcessingTask = (
  taskName: string,
  result: boolean,
) => {
  const callbacks = registeredCallbacks[taskName];
  if (callbacks != null) {
    PLXEventEmitter.removeListener(
      BackgroundProcessingExecuting,
      callbacks.execution,
    );
    PLXEventEmitter.removeListener(
      BackgroundProcessingExpired,
      callbacks.expired,
    );
    delete registeredCallbacks[taskName];
  }
  PLXBackground.completeBackgroundProcessing(taskName, result);
};

/**
 * Cancel background processing task.
 * @param taskName Task name
 */
const cancelBackgroundProcessingTask = (taskName: string) => {
  const callbacks = registeredCallbacks[taskName];
  if (callbacks != null) {
    PLXEventEmitter.removeListener(
      BackgroundProcessingExecuting,
      callbacks.execution,
    );
    PLXEventEmitter.removeListener(
      BackgroundProcessingExpired,
      callbacks.expired,
    );
    delete registeredCallbacks[taskName];
  }
  PLXBackground.cancelBackgroundProcess(taskName);
};

/**
 * Cancel all background processing tasks
 */
const cancelAllBackgroundProcessingTasks = () => {
  PLXEventEmitter.removeAllListeners(BackgroundProcessingExecuting);
  PLXEventEmitter.removeAllListeners(BackgroundProcessingExpired);
  registeredCallbacks = {};
};

export default {
  setTimeout,
  clearTimeout,
  startBackgroundTask,
  endBackgroundTask: PLXBackground.endBackgroundTask,
  scheduleBackgroundProcessingTask,
  completeBackgroundProcessingTask,
  cancelBackgroundProcessingTask,
  cancelAllBackgroundProcessingTasks,
};
