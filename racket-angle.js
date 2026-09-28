export function normalizeAngle(angle) {
    return ((angle + 180) % 360 + 360) % 360 - 180;
}

const MAX_FACE_ANGLE = 90;

export function getRacketFaceAngle(sensorAngle) {
    if (!Number.isFinite(sensorAngle)) return null;

    const faceAngle = MAX_FACE_ANGLE - Math.abs(normalizeAngle(sensorAngle));
    return faceAngle === 0 ? 0 : faceAngle;
}

export function getRacketFaceState(faceAngle, neutralTolerance = 5) {
    if (!Number.isFinite(faceAngle)) return "Waiting";
    if (faceAngle > neutralTolerance) return "Open";
    if (faceAngle < -neutralTolerance) return "Closed";
    return "Neutral";
}
