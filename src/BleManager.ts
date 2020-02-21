import {
  BleManager,
  State,
  Device,
  BleError,
  Subscription,
} from 'react-native-ble-plx';
import {log} from './Utils';
import Base64 from 'base64-js';
import Background from './Background';

export const serviceUUID = '00001000-3a53-9db1-0643-2a72eaff78b2';
export const txUUID = '00001001-3a53-9db1-0643-2a72eaff78b2';
export const rxUUID = '00001002-3a53-9db1-0643-2a72eaff78b2';

/**
 * Constructing BleManager.
 */
const manager = new BleManager({
  restoreStateIdentifier: 'BleInTheBackground',
  restoreStateFunction: restoredState => {
    if (restoredState == null) {
      log('Ble Manager not restored');
    } else {
      const devices = restoredState.connectedPeripherals;
      if (devices.length === 0) {
        log('No connected devices to restore...');
      } else {
        const device = devices[0];
        log('Restoring device...');
        restoredProcess(device)
          .then(() => {
            log('Restoration completed');
          })
          .catch(() => {
            log('Restoration failed');
          });
      }
      log(
        `BleManager restored: ${restoredState.connectedPeripherals.map(
          device => device.name,
        )}`,
      );
    }
  },
});

/**
 * Wait for specified BLE state.
 * @param state BLE state to wait for
 */
export const waitForBLEState = (state: State) => {
  return new Promise<void>(resolve => {
    const subscription = manager.onStateChange(newState => {
      log(`BLE state: ${newState}`);
      if (newState === state) {
        subscription.remove();
        resolve();
      }
    }, true);
  });
};

/**
 * Scan for BLE device.
 * @param timeout Maximum time to wait for scanning operation to complete. Pass 0 to scan infinietly.
 */
export const scanDevice: (timeout: number) => Promise<Device> = (
  timeout: number,
) => {
  return new Promise((resolve, reject) => {
    // Define subscriptions.
    const subscriptions: {
      timeout: number | null;
    } = {timeout: null};

    // Function to clear all subscriptions.
    const clearSubscriptions = () => {
      manager.stopDeviceScan();
      if (subscriptions.timeout) {
        Background.clearTimeout(subscriptions.timeout);
        subscriptions.timeout = null;
      }
    };

    // Specify timeout if value is larger than 0.
    if (timeout > 0) {
      subscriptions.timeout = Background.setTimeout(() => {
        subscriptions.timeout = null;
        clearSubscriptions();
        reject(new Error(`Scan timeout after ${timeout} ms`));
      }, timeout);
    }

    // Start scanning.
    manager.startDeviceScan(
      [serviceUUID],
      {allowDuplicates: true},
      (error, scannedDevice) => {
        if (error != null) {
          clearSubscriptions();
          reject(error);
        }
        if (scannedDevice != null) {
          if (
            scannedDevice.serviceUUIDs?.find(uuid => {
              return uuid === serviceUUID;
            })
          ) {
            clearSubscriptions();
            resolve(scannedDevice);
          }
        }
      },
    );
  });
};

/**
 *
 * @param device         Device to connect.
 * @param timeout        Timeout after which we abort connection.
 * @param onDisconnected Callback emitted when device disconnected.
 */
export const connectToDevice = async (
  device: Device,
  timeout: number | undefined,
  onDisconnected?: (error: BleError | null) => void,
) => {
  const subscription = device.onDisconnected(error => {
    log('Disconnected!');
    subscription.remove();
    if (onDisconnected) {
      onDisconnected(error);
    }
  });

  if (await device.isConnected()) {
    log('Device is already connected');
  } else {
    log('Connecting to the device...');
    await device.connect({timeout});
  }

  log('Discovering device...');
  await device.discoverAllServicesAndCharacteristics();

  log('Device connected!');
  return device;
};

/**
 * Function send request to get X ticks and wait for them.
 *
 * @param device     Device to get ticks from.
 * @param totalTicks Total number of ticks to receive.
 * @param onTick     Callback emitted when new ticks are received.
 */
export const downloadTicks = (
  device: Device,
  totalTicks: number,
  onTick?: (
    tickCount: number,
    totalTickCount: number,
    tickValue: number,
  ) => void,
) => {
  return new Promise((resolve, reject) => {
    if (totalTicks <= 0 || totalTicks >= 256) {
      reject(new Error('Total ticks number should be > 0 and < 256'));
      return;
    }

    let receivedTicks = 0;
    const subscription = device.monitorCharacteristicForService(
      serviceUUID,
      rxUUID,
      (error, characteristic) => {
        if (error != null) {
          reject(error);
          return;
        }

        if (characteristic != null && characteristic.value != null) {
          const bytes = Base64.toByteArray(characteristic.value);
          const ticks = new DataView(bytes.buffer).getUint32(0, true);
          receivedTicks++;
          if (onTick) {
            onTick(receivedTicks, totalTicks, ticks);
          }

          if (receivedTicks === totalTicks) {
            subscription.remove();
            resolve(totalTicks);
            return;
          }
        }
      },
    );

    const buffer = new Uint8Array(1);
    buffer[0] = totalTicks;
    device
      .writeCharacteristicWithoutResponseForService(
        serviceUUID,
        txUUID,
        Base64.fromByteArray(buffer),
      )
      .then(
        () => {
          log(`Wrote ${totalTicks} ticks request`);
        },
        error => {
          subscription.remove();
          reject(error);
        },
      );
  });
};

/**
 * Wait for pending ticks on a device.
 * @param device      Device to monitor ticks.
 * @param tickTimeout Tick timeout after which we assume there are no pending events.
 * @param onTick      Callback invoked every tick.
 */
const waitForPendingTicks = (
  device: Device,
  tickTimeout: number,
  onTick?: (tickValue: number) => void,
) => {
  return new Promise<void>((resolve, reject) => {
    // Define subscriptions.
    const subscriptions: {
      monitor: Subscription | null;
      timeout: number | null;
    } = {monitor: null, timeout: null};

    // Clear subscriptions.
    const clearSubscriptions = () => {
      if (subscriptions.monitor != null) {
        subscriptions.monitor.remove();
        subscriptions.monitor = null;
      }
      if (subscriptions.timeout != null) {
        Background.clearTimeout(subscriptions.timeout);
        subscriptions.timeout = null;
      }
    };

    // Start tick timeout
    subscriptions.timeout = Background.setTimeout(() => {
      subscriptions.timeout = null;
      clearSubscriptions();
      resolve();
    }, tickTimeout);

    // Monitor characteristuc
    subscriptions.monitor = device.monitorCharacteristicForService(
      serviceUUID,
      rxUUID,
      (error, characteristic) => {
        if (error != null) {
          // On error, reject promise.
          subscriptions.monitor = null;
          clearSubscriptions();
          reject(error);
          return;
        }

        if (characteristic != null && characteristic.value != null) {
          // Convert tick
          const bytes = Base64.toByteArray(characteristic.value);
          const ticks = new DataView(bytes.buffer).getUint32(0, true);
          if (onTick) {
            onTick(ticks);
          }

          // Restart tick timeout
          if (subscriptions.timeout != null) {
            Background.clearTimeout(subscriptions.timeout);
          }
          subscriptions.timeout = Background.setTimeout(() => {
            subscriptions.timeout = null;
            clearSubscriptions();
            resolve();
          }, tickTimeout);
        }
      },
    );
  });
};

/**
 * Establishes connection with device.
 * @param onDisconnected Callback invoked when device is disconnected.
 */
export const establishConnection = async (
  onDisconnected?: (error: BleError | null) => void,
) => {
  // Make sure we are in PoweredOn state.
  log('Waiting for PoweredOn state...');
  await waitForBLEState(State.PoweredOn);

  // Check if there are connected devices
  log('Checking connected devices...');
  const connectedDevices = await manager.connectedDevices([serviceUUID]);
  let device: Device;

  if (connectedDevices.length > 0) {
    // Use already connected device.
    log('Already connected...');
    device = connectedDevices[0];
  } else {
    // Scan for device.
    log('Scanning for device...');
    device = await scanDevice(5000);
  }

  // Establish connection and make sure that services are discovered.
  log('Preparing connection...');
  await connectToDevice(device, 5000, onDisconnected);

  return device;
};

/**
 * Cancels all pending connections
 */
export const cancelAllConnections = async () => {
  const connectedDevices = await manager.connectedDevices([serviceUUID]);
  for (let device of connectedDevices) {
    await device.cancelConnection();
  }
};

/**
 * Execute simple job.
 * @param device Device to execute command.
 */
export const executeJob = async (device: Device) => {
  log('Executing job!');
  const taskStartTime = Date.now();
  const taskName = taskStartTime.toString();
  Background.startBackgroundTask(taskName, () => {
    log(`Task ${taskName} expired`);
    Background.endBackgroundTask(taskName);
  });
  log(`Task ${taskName} started`);
  await downloadTicks(device, 255, (start, end, tickValue) => {
    log(`Task ${taskName} value=${tickValue} completed=${start}/${end}`);
  });
  Background.endBackgroundTask(taskName);
  log(`Task ${taskName} finished`);
};

/**
 * Try to catch all pending events.
 * @param device Device to restore.
 */
export const restoredProcess = async (device: Device) => {
  log('Restoring process!');
  const taskStartTime = Date.now();
  const taskName = taskStartTime.toString();
  Background.startBackgroundTask(taskName, () => {
    log(`Task ${taskName} expired`);
    Background.endBackgroundTask(taskName);
  });
  log(`Task ${taskName} started`);
  try {
    log('Make sure that device is connected...');
    await connectToDevice(device, 2000);
    log('Waiting for pending events...');
    await waitForPendingTicks(device, 10000, tickValue => {
      log(`Task ${taskName} value=${tickValue}`);
    });
    log('Closing all connections...');
    await cancelAllConnections();
  } catch (error) {
    log(`Registered an error: ${error.message}`);
  }
  Background.endBackgroundTask(taskName);
  log(`Task ${taskName} finished`);
};

export const scheduleBackgroundProcessingTask = async () => {
  log('Scheduled background processing task...');
  Background.cancelAllBackgroundProcessingTasks();
  await Background.scheduleBackgroundProcessingTask(
    'LongRunningTask',
    16 * 60 * 1000,
    taskName => {
      log(`Executing ${taskName}...`);
      (async () => {
        const device = await establishConnection();
        await downloadTicks(device, 10, () => {
          log(`Task ${taskName} received tick!`);
        });
        await cancelAllConnections();
      })()
        .then(() => {
          log(`Task ${taskName} finished...`);
          Background.completeBackgroundProcessingTask(taskName, true);
        })
        .catch(error => {
          log(`Task ${taskName} failed with error: ${error.message}`);
          Background.completeBackgroundProcessingTask(taskName, true);
        });
    },
    taskName => {
      log(`Task ${taskName} expired.......`);
      Background.completeBackgroundProcessingTask(taskName, false);
    },
  );
};
