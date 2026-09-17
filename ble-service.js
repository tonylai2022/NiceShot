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
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ name: 'XIAO-Tennis' }],
                optionalServices: [this.serviceUuid]
            });

            this.device.addEventListener('gattserverdisconnected', () => {
                this.onConnectionChange(false);
            });

            const server = await this.device.gatt.connect();
            const service = await server.getPrimaryService(this.serviceUuid);
            const characteristics = await service.getCharacteristics();
            
            this.characteristic = characteristics[0];
            await this.characteristic.startNotifications();
            this.characteristic.addEventListener('characteristicvaluechanged', (e) => this._handleNotification(e));

            this.onConnectionChange(true, this.device.name);
        } catch (error) {
            console.error("BLE Connection Error:", error);
            throw error;
        }
    }

    _handleNotification(event) {
        const value = event.target.value;
        if (value.byteLength >= 6) {
            const gRaw = value.getUint16(0, true);
            const timeMs = value.getUint32(2, true);
            const peakG = gRaw / 100.0;

            if (this.onImpactCallback) {
                this.onImpactCallback({ timeMs, peakG });
            }
        }
    }
}