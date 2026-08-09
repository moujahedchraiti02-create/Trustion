console.log("Hello from @workspace/scripts");
import { readModbusData } from './modbus-reader';
import { readGPSData } from './nmea-reader';
import { signEvent } from './signer';
import { enqueue, flush } from './queue';
import { config } from './config';

let sequence = 0;

async function main() {
  setInterval(async () => {
    try {
      const engine = await readModbusData();
      const gps = await readGPSData();
      sequence++;

      const event = {
        schema_version: "1.0",
        vessel_imo: config.IMO,
        device_id: config.DEVICE_ID,
        sequence_number: sequence,
        period_id: `2026-W${Math.ceil(new Date().getDate() / 7)}`,
        gps_time: gps.timestamp,
        engine_load: engine.load_pct,
        fuel_consumed_kg: engine.fuel_kg,
        latitude: gps.latitude,
        longitude: gps.longitude,
        hdop: gps.hdop,
      };

      const signature = signEvent(event);
      const signedEvent = { ...event, signature };

      enqueue(signedEvent);
      await flush();

    } catch (error) {
      console.error('❌ Error in agent loop:', error);
    }
  }, 60000);
}

console.log('🚀 S³V Edge Agent started');
main();