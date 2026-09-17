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

// Advanced Stroke Classification with Righty / Lefty Support
function processImpact({ timeMs, peakG }) {
    let strokeType = "Standard Stroke";
    const isLefty = handednessSelect.value === 'left';

    if (latestLandmarks) {
        // Index 16 = Right Wrist, Index 15 = Left Wrist
        const activeWristIndex = isLefty ? 15 : 16;
        const activeWrist = latestLandmarks[activeWristIndex];

        const leftShoulder = latestLandmarks[11];
        const rightShoulder = latestLandmarks[12];
        const torsoCenterX = (leftShoulder.x + rightShoulder.x) / 2;

        // Calculate motion velocity vector
        const wristVelocityX = activeWrist.x - previousWristX;

        if (!isLefty) {
            // --- RIGHT-HANDED PLAYER LOGIC ---
            // Right wrist crossing left of torso center or moving dynamically across indicates backhand
            const isBackhandZone = activeWrist.x < torsoCenterX || (activeWrist.x < rightShoulder.x && wristVelocityX < 0);

            if (isBackhandZone) {
                strokeType = peakG > 5.5 ? "Backhand Drive" : "Backhand Slice";
            } else {
                strokeType = peakG > 6.5 ? "Forehand Smash / Heavy Drive" : "Forehand Drive";
            }
        } else {
            // --- LEFT-HANDED PLAYER LOGIC ---
            // Left wrist crossing right of torso center indicates backhand for a lefty
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

    const record = { timeMs, peakG, type: strokeType };
    hitHistory.push(record);

    peakGText.textContent = `${peakG.toFixed(2)} G`;
    totalHitsText.textContent = hitHistory.length;
    strokeText.textContent = strokeType;
    strokeText.className = "text-lg font-bold text-amber-400 mt-1";

    appendLog(record);
}

function appendLog(record) {
    if (hitHistory.length === 1) logContainer.innerHTML = "";
    const logItem = document.createElement('div');
    logItem.className = "p-2 bg-slate-950 border border-slate-800 rounded-lg flex justify-between items-center";
    logItem.innerHTML = `
        <span class="text-emerald-400">${record.type}</span>
        <span class="text-slate-300 font-mono">${record.peakG.toFixed(2)}G</span>
        <span class="text-slate-500">${record.timeMs}ms</span>
    `;
    logContainer.prepend(logItem);
}

clearLogBtn.addEventListener('click', () => {
    hitHistory = [];
    logContainer.innerHTML = `<div class="text-slate-500 italic">No impacts recorded yet. Swing racket...</div>`;
    totalHitsText.textContent = "0";
    peakGText.textContent = "0.00 G";
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