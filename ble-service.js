export class TennisBLEService {
    constructor(serviceUuid, onImpactCallback, onConnectionChange) {
        this.serviceUuid = serviceUuid;
        this.onImpactCallback = onImpactCallback;
        this.onConnectionChange = onConnectionChange;
        this.device = null;
        this.characteristic = null;
    }

    async connect() {
        try {
            console.log("[BLE] Step 1: Requesting Bluetooth device...");
            this.device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: [this.serviceUuid]
            });

            console.log("[BLE] Step 2: Device selected:", this.device.name || "Unknown", this.device.id);

            this.device.addEventListener('gattserverdisconnected', () => {
                console.warn("[BLE] Device disconnected unexpectedly");
                this.onConnectionChange(false);
            });

            console.log("[BLE] Step 3: Connecting to GATT server...");
            const server = await this.device.gatt.connect();

            console.log("[BLE] Step 4: Getting primary service:", this.serviceUuid);
            const service = await server.getPrimaryService(this.serviceUuid);

            console.log("[BLE] Step 5: Fetching characteristics...");
            const characteristics = await service.getCharacteristics();
            console.log(`[BLE] Found ${characteristics.length} characteristics.`);

            if (characteristics.length === 0) {
                throw new Error("No characteristics found under this service UUID!");
            }

            this.characteristic = characteristics[0];
            console.log("[BLE] Step 6: Starting notifications...");
            await this.characteristic.startNotifications();

            this.characteristic.addEventListener('characteristicvaluechanged', (e) => this._handleNotification(e));

            console.log("[BLE] Success! Fully connected and subscribed.");
            this.onConnectionChange(true, this.device.name || "XIAO-Tennis");
        } catch (error) {
            console.error("[BLE Connection Error Detail]:", error);
            alert(`BLE Error: ${error.message || error}`);
            throw error;
        }
    }

    _handleNotification(event) {
        const value = event.target.value;

        // 確保至少有 10 bytes
        if (value.byteLength >= 10) {
            // 使用 true 代表 Little-endian（nRF52 系列預設為 Little-endian）
            const peakG = value.getFloat32(0, true);
            const maxGyro = value.getFloat32(4, true);
            const duration = value.getUint16(8, true);

            if (this.onImpactCallback) {
                this.onImpactCallback({
                    peakG: isNaN(peakG) ? 0 : peakG,
                    maxGyro: isNaN(maxGyro) ? 0 : maxGyro,
                    duration: isNaN(duration) ? 0 : duration
                });
            }
        } else {
            console.warn(`[BLE] Unexpected packet length: ${value.byteLength} bytes`);
        }
    }

    async disconnect() {
        if (this.device && this.device.gatt.connected) {
            await this.device.gatt.disconnect();
            console.log('Disconnected successfully.');
        }
    }
}