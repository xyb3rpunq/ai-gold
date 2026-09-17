// Web Worker: semua jaringan + perhitungan berat (indikator & pelatihan AI) di sini,
// supaya UI di main thread tetap mulus.
import { DataHub } from './hub.js';

const hub = new DataHub((msg) => self.postMessage(msg));
self.onmessage = (e) => {
  if (e.data?.type === 'select') hub.select(e.data.tf);
  if (e.data?.type === 'broker') hub.setBroker(e.data.broker);
};
hub.start();
