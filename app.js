import { TennisBLEService } from './ble-service.js';

const SERVICE_UUID = "19b10000-e8f2-537e-4f6c-d104768a1214";

let hitHistory = [];
let latestLandmarks = null;
let previousWristX = 0;

// DOM Elements
const connectBtn = document.getElementById('connectBtn');
const bleStatus = document.getElementById('bleStatus');
const strokeText = document.getElementById('strokeText');
const peakGText = document.getElementById('peakGText');
const maxGyroText = document.getElementById('maxGyroText');
const durationText = document.getElementById('durationText');
const totalHitsText = document.getElementById('totalHitsText');
const logContainer = document.getElementById('logContainer');
const clearLogBtn = document.getElementById('clearLogBtn');
const handednessSelect = document.getElementById('handednessSelect');

const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('outputCanvas');
const canvasCtx = canvasElement.getContext('2d');

const bleService = new TennisBLEService(
    SERVICE_UUID,
    (impactData) => processImpact(impactData),
    (isConnected, deviceName) => updateConnectionUI(isConnected, deviceName)
);

connectBtn.addEventListener('click', async () => {
    bleStatus.textContent = "Status: Scanning...";
    bleStatus.className = "flex items-center px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-blue-400";
    try {
        await bleService.connect();
    } catch (e) {
        bleStatus.textContent = "Status: Connection Failed";
        bleStatus.className = "flex items-center px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-red-400";
    }
});

function updateConnectionUI(isConnected, name) {
    if (isConnected) {
        bleStatus.textContent = `Status: Connected (${name})`;
        bleStatus.className = "flex items-center px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-emerald-400";
        connectBtn.textContent = "Connected";
        connectBtn.classList.replace('bg-emerald-600', 'bg-slate-800');
        connectBtn.disabled = true;
    } else {
        bleStatus.textContent = "Status: Disconnected";
        bleStatus.className = "flex items-center px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-amber-400";
        connectBtn.textContent = "Connect Sensor (BLE)";
        connectBtn.classList.replace('bg-slate-800', 'bg-emerald-600');
        connectBtn.disabled = false;
    }
}

// 根據不同揮拍類型指定專屬 Tailwind 顏色樣式
function getStrokeStyle(strokeType) {
    if (strokeType.includes("Smash") || strokeType.includes("Heavy")) {
        return { text: "text-purple-400", bg: "bg-purple-950/40 border-purple-800/60" };
    } else if (strokeType.includes("Backhand")) {
        return { text: "text-cyan-400", bg: "bg-cyan-950/40 border-cyan-800/60" };
    } else if (strokeType.includes("Slice")) {
        return { text: "text-amber-400", bg: "bg-amber-950/40 border-amber-800/60" };
    } else {
        return { text: "text-emerald-400", bg: "bg-emerald-950/40 border-emerald-800/60" };
    }
}

// 進階揮拍分類與多指標處理（含資料防呆）
function processImpact(impactData) {
    const peakG = (impactData && typeof impactData.peakG === 'number') ? impactData.peakG : 0;
    const maxGyro = (impactData && typeof impactData.maxGyro === 'number') ? impactData.maxGyro : 0;
    const duration = (impactData && typeof impactData.duration === 'number') ? impactData.duration : 0;

    let strokeType = "Standard Stroke";
    const isLefty = handednessSelect.value === 'left';

    if (latestLandmarks) {
        const activeWristIndex = isLefty ? 15 : 16;
        const activeWrist = latestLandmarks[activeWristIndex];

        const leftShoulder = latestLandmarks[11];
        const rightShoulder = latestLandmarks[12];
        const torsoCenterX = (leftShoulder.x + rightShoulder.x) / 2;

        const wristVelocityX = activeWrist.x - previousWristX;

        if (!isLefty) {
            const isBackhandZone = activeWrist.x < torsoCenterX || (activeWrist.x < rightShoulder.x && wristVelocityX < 0);

            if (isBackhandZone) {
                strokeType = peakG > 5.5 ? "Backhand Drive" : "Backhand Slice";
            } else {
                strokeType = peakG > 6.5 ? "Forehand Smash / Heavy Drive" : "Forehand Drive";
            }
        } else {
            const isBackhandZone = activeWrist.x > torsoCenterX || (activeWrist.x > leftShoulder.x && wristVelocityX > 0);

            if (isBackhandZone) {
                strokeType = peakG > 5.5 ? "Backhand Drive" : "Backhand Slice";
            } else {
                strokeType = peakG > 6.5 ? "Forehand Smash / Heavy Drive" : "Forehand Drive";
            }
        }
    } else {
        strokeType = peakG > 6.0 ? "Heavy Impact" : "Standard Stroke";
    }

    const timestampMs = Date.now();
    const record = { timeMs: timestampMs, peakG, maxGyro, duration, type: strokeType };
    hitHistory.push(record);

    // 更新 HUD 顯示（安全防呆 toFixed）
    peakGText.textContent = `${peakG.toFixed(2)} G`;
    if (maxGyroText) maxGyroText.textContent = `${maxGyro.toFixed(1)} °/s`;
    if (durationText) durationText.textContent = `${duration} ms`;
    totalHitsText.textContent = hitHistory.length;

    const style = getStrokeStyle(strokeType);
    strokeText.textContent = strokeType;
    strokeText.className = `text-lg font-bold ${style.text} mt-1`;

    appendLog(record, style);
}

function appendLog(record, style) {
    if (hitHistory.length === 1) logContainer.innerHTML = "";
    const logItem = document.createElement('div');
    logItem.className = `p-2.5 bg-slate-950 border ${style.bg} rounded-lg flex justify-between items-center text-xs`;
    logItem.innerHTML = `
        <span class="${style.text} font-bold">${record.type}</span>
        <div class="flex gap-3 font-mono text-slate-300">
            <span>${record.peakG.toFixed(2)}G</span>
            <span>${record.maxGyro.toFixed(0)}°/s</span>
            <span class="text-slate-400">${record.duration}ms</span>
        </div>
    `;
    logContainer.prepend(logItem);
}

clearLogBtn.addEventListener('click', () => {
    hitHistory = [];
    logContainer.innerHTML = `<div class="text-slate-500 italic">No impacts recorded yet. Swing racket...</div>`;
    totalHitsText.textContent = "0";
    peakGText.textContent = "0.00 G";
    if (maxGyroText) maxGyroText.textContent = "0.00 °/s";
    if (durationText) durationText.textContent = "0 ms";
    strokeText.textContent = "Tracking Active";
    strokeText.className = "text-lg font-bold text-emerald-400 mt-1";
});

// --- MediaPipe Pose Integration ---
function onResults(results) {
    canvasElement.width = videoElement.videoWidth || 640;
    canvasElement.height = videoElement.videoHeight || 480;

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.poseLandmarks) {
        latestLandmarks = results.poseLandmarks;
        const isLefty = handednessSelect.value === 'left';
        const activeWristIndex = isLefty ? 15 : 16;

        previousWristX = latestLandmarks[activeWristIndex].x;

        drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS, { color: '#10b981', lineWidth: 2 });
        drawLandmarks(canvasCtx, results.poseLandmarks, { color: '#ef4444', lineWidth: 1, radius: 3 });
    }
    canvasCtx.restore();
}

const pose = new Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
});

pose.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    enableSegmentation: false,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});
pose.onResults(onResults);

const camera = new Camera(videoElement, {
    onFrame: async () => {
        await pose.send({ image: videoElement });
    },
    width: 640,
    height: 480
});
camera.start();