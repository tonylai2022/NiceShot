const HISTORY_MS = 1800;
const PRE_IMPACT_MS = 800;
const POST_IMPACT_MS = 220;
const MIN_FRAMES = 6;

function distance(first, second) {
    return Math.hypot(second.x - first.x, second.y - first.y);
}

function pathLength(frames, key) {
    let total = 0;
    for (let index = 1; index < frames.length; index++) {
        total += distance(frames[index - 1][key], frames[index][key]);
    }
    return total;
}

function nearestFrame(frames, timestamp) {
    return frames.reduce((nearest, frame) => (
        Math.abs(frame.timestamp - timestamp) < Math.abs(nearest.timestamp - timestamp) ? frame : nearest
    ));
}

function elbowAngle(frame) {
    const shoulderToElbow = {
        x: frame.shoulder.x - frame.elbow.x,
        y: frame.shoulder.y - frame.elbow.y
    };
    const wristToElbow = {
        x: frame.wrist.x - frame.elbow.x,
        y: frame.wrist.y - frame.elbow.y
    };
    const dot = shoulderToElbow.x * wristToElbow.x + shoulderToElbow.y * wristToElbow.y;
    const magnitudes = Math.hypot(shoulderToElbow.x, shoulderToElbow.y)
        * Math.hypot(wristToElbow.x, wristToElbow.y);
    if (magnitudes === 0) return 0;
    return Math.acos(Math.max(-1, Math.min(1, dot / magnitudes))) * 180 / Math.PI;
}

export function classifySwingTrajectory(frames, impactTimestamp) {
    const swingFrames = frames.filter((frame) => (
        frame.timestamp >= impactTimestamp - PRE_IMPACT_MS
        && frame.timestamp <= impactTimestamp + POST_IMPACT_MS
    ));

    if (swingFrames.length < MIN_FRAMES) {
        return { available: false, strokeType: "Standard Stroke", strokeSide: null, confidence: 0, features: null };
    }

    const contactFrame = nearestFrame(swingFrames, impactTimestamp);
    const preFrames = swingFrames.filter((frame) => frame.timestamp <= impactTimestamp);
    const postFrames = swingFrames.filter((frame) => frame.timestamp >= impactTimestamp);
    const approachFrame = nearestFrame(preFrames, impactTimestamp - 250);
    const finishFrame = postFrames.length > 0 ? postFrames[postFrames.length - 1] : contactFrame;
    const firstFrame = swingFrames[0];
    const strokeSide = contactFrame.wrist.x < 0 ? "Backhand" : "Forehand";
    const totalPath = pathLength(swingFrames, "wrist");
    const backswingPath = pathLength(preFrames, "wrist");
    const followThroughPath = pathLength(postFrames, "wrist");
    const verticalThroughContact = finishFrame.wrist.y - approachFrame.wrist.y;
    const horizontalThroughContact = finishFrame.wrist.x - approachFrame.wrist.x;
    const wristAboveShoulder = contactFrame.wrist.y;
    const armExtension = elbowAngle(contactFrame);
    const tossStart = firstFrame.oppositeWrist.y;
    const tossPeak = Math.max(...preFrames.map((frame) => frame.oppositeWrist.y));
    const tossRise = tossPeak - tossStart;

    const features = {
        totalPath,
        backswingPath,
        followThroughPath,
        verticalThroughContact,
        horizontalThroughContact,
        wristAboveShoulder,
        armExtension,
        tossRise,
        frameCount: swingFrames.length
    };

    let baseType;
    let confidence;

    if (wristAboveShoulder > 0.45 && armExtension > 125) {
        if (tossRise > 0.35 && tossPeak > 0.15) {
            baseType = "Serve";
            confidence = 0.82;
        } else {
            baseType = "Smash";
            confidence = 0.72;
        }
    } else if (totalPath < 1.15 && backswingPath < 0.75 && followThroughPath < 0.65) {
        baseType = "Volley";
        confidence = 0.72;
    } else if (verticalThroughContact < -0.22) {
        baseType = "Slice";
        confidence = Math.min(0.92, 0.62 + Math.abs(verticalThroughContact) * 0.35);
    } else if (verticalThroughContact > 0.25) {
        baseType = "Topspin";
        confidence = Math.min(0.92, 0.62 + verticalThroughContact * 0.35);
    } else {
        baseType = "Flat Groundstroke";
        confidence = 0.65;
    }

    const strokeType = ["Serve", "Smash"].includes(baseType)
        ? baseType
        : `${strokeSide} ${baseType}`;

    return { available: true, strokeType, strokeSide, confidence, features };
}

export class PoseTrajectoryBuffer {
    constructor() {
        this.frames = [];
    }

    addLandmarks(landmarks, isLefty, cameraView = "rear", timestamp = performance.now()) {
        const wristIndex = isLefty ? 15 : 16;
        const elbowIndex = isLefty ? 13 : 14;
        const shoulderIndex = isLefty ? 11 : 12;
        const oppositeWristIndex = isLefty ? 16 : 15;
        const leftShoulder = landmarks[11];
        const rightShoulder = landmarks[12];
        const shoulderWidth = Math.hypot(
            rightShoulder.x - leftShoulder.x,
            rightShoulder.y - leftShoulder.y
        );

        if (!Number.isFinite(shoulderWidth) || shoulderWidth < 0.02) return;

        const centerX = (leftShoulder.x + rightShoulder.x) / 2;
        const centerY = (leftShoulder.y + rightShoulder.y) / 2;
        const handednessDirection = isLefty ? -1 : 1;
        const cameraDirection = cameraView === "front" ? -1 : 1;
        const normalize = (point) => ({
            x: (point.x - centerX) / shoulderWidth * handednessDirection * cameraDirection,
            y: (centerY - point.y) / shoulderWidth
        });

        this.frames.push({
            timestamp,
            wrist: normalize(landmarks[wristIndex]),
            elbow: normalize(landmarks[elbowIndex]),
            shoulder: normalize(landmarks[shoulderIndex]),
            oppositeWrist: normalize(landmarks[oppositeWristIndex])
        });

        const oldestTimestamp = timestamp - HISTORY_MS;
        while (this.frames.length > 0 && this.frames[0].timestamp < oldestTimestamp) this.frames.shift();
    }

    classify(impactTimestamp) {
        return classifySwingTrajectory(this.frames, impactTimestamp);
    }

    clear() {
        this.frames = [];
    }
}
