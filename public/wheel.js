const canvas = document.getElementById('wheelCanvas');
const ctx = canvas.getContext('2d');
const wheelContainer = document.querySelector('.wheel-container');

canvas.width = 600;
canvas.height = 600;

const segments = 20;
const redSegments = 18; // 90% lose
const greenSegments = 2; // 10% win

let currentRotation = 0;
let isSpinning = false;

const loseImage = new Image();
loseImage.src = 'assets/Lose.webp';
loseImage.onerror = () => console.error('Failed to load Lose.webp');

const winImage = new Image();
winImage.src = 'assets/Win.png';
winImage.onerror = () => console.error('Failed to load Win.png');

const winSound = new Audio('assets/w_Brian.wav');
const loseSound = new Audio('assets/L_Brian.wav');

winSound.volume = 1.0;
loseSound.volume = 1.0;

winSound.addEventListener('canplaythrough', () => console.log('Win sound loaded successfully'));
winSound.addEventListener('error', (e) => console.error('Win sound failed to load:', e));
loseSound.addEventListener('canplaythrough', () => console.log('Lose sound loaded successfully'));
loseSound.addEventListener('error', (e) => console.error('Lose sound failed to load:', e));

// Create Web Audio context for tick sound
const audioContext = new (window.AudioContext || window.webkitAudioContext)();

function playTickSound() {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Warm, upbeat thock - higher than deep bass but still substantial
    oscillator.frequency.value = 300; // Mid-range for upbeat but solid feel
    oscillator.type = 'sine';

    // Clean, snappy envelope at 50% volume
    gainNode.gain.setValueAtTime(0.15, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.07);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.07);
}

function drawWheel(rotation = 0) {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = canvas.width / 2 - 20;
    const anglePerSegment = (2 * Math.PI) / segments;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(rotation);

    // Draw background image clipped to circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, 2 * Math.PI);
    ctx.clip();

    if (loseImage.complete && loseImage.naturalHeight !== 0) {
        const imageSize = radius * 2;
        ctx.drawImage(
            loseImage,
            -imageSize / 2,
            -imageSize / 2,
            imageSize,
            imageSize
        );
    } else {
        ctx.fillStyle = '#ff0000';
        ctx.fill();
    }
    ctx.restore();

    // Draw VIP segments with gold overlay
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    for (let i = redSegments; i < segments; i++) {
        const angle = i * anglePerSegment;
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, radius, angle, angle + anglePerSegment);
    }
    ctx.closePath();
    ctx.fillStyle = '#FFD700';
    ctx.fill();
    ctx.restore();

    // Draw VIP text and image
    const greenCenterAngle = (redSegments * anglePerSegment) + (greenSegments * anglePerSegment / 2);
    const textDistance = radius * 0.85;

    ctx.save();
    ctx.translate(
        textDistance * Math.cos(greenCenterAngle),
        textDistance * Math.sin(greenCenterAngle)
    );
    ctx.rotate(greenCenterAngle + Math.PI / 2);
    ctx.font = '36px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#00ff00';
    ctx.fillText('VIP', 0, 0);

    if (winImage.complete && winImage.naturalHeight !== 0) {
        const imgSize = 70;
        ctx.drawImage(
            winImage,
            -imgSize / 2,
            15,
            imgSize,
            imgSize
        );
    }
    ctx.restore();

    // Draw borders
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 3;

    const winStartAngle = redSegments * anglePerSegment;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(radius * Math.cos(winStartAngle), radius * Math.sin(winStartAngle));
    ctx.stroke();

    const winEndAngle = segments * anglePerSegment;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(radius * Math.cos(winEndAngle), radius * Math.sin(winEndAngle));
    ctx.stroke();

    // Draw BAN text
    ctx.font = '300 36px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ff0000';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 10;
    ctx.fillText('BAN', 0, -radius * 0.8);
    ctx.shadowBlur = 0;

    // Draw outer ring
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.restore();
}

function spinWheel(isWin, duration = 14000) {
    if (isSpinning) return;
    isSpinning = true;

    wheelContainer.classList.add('visible');
    drawWheel(0);

    const spinsBeforeStop = 8;
    const anglePerSegment = (2 * Math.PI) / segments;

    let targetSegment;
    if (isWin) {
        targetSegment = redSegments + Math.floor(Math.random() * greenSegments);
        console.log(`WIN: Landing on segment ${targetSegment} (GREEN)`);
    } else {
        targetSegment = Math.floor(Math.random() * redSegments);
        console.log(`LOSE: Landing on segment ${targetSegment} (RED)`);
    }

    const segmentCenterAngle = targetSegment * anglePerSegment + anglePerSegment / 2;
    const pointerAngle = (3 * Math.PI) / 2;
    let targetAngle = pointerAngle - segmentCenterAngle;

    if (targetAngle < 0) {
        targetAngle += 2 * Math.PI;
    }

    const totalRotation = (spinsBeforeStop * 2 * Math.PI) + targetAngle;

    console.log(`Rotation calc: targetAngle=${targetAngle.toFixed(3)}, totalRotation=${totalRotation.toFixed(3)}`);
    console.log(`After spin, segment ${targetSegment} should be at pointer`);

    canvas.style.setProperty('--spin-degrees', `${totalRotation * (180 / Math.PI)}deg`);
    canvas.style.setProperty('--spin-duration', `${duration}ms`);

    canvas.classList.add('spinning');

    // Track segment crossings during spin
    const startTime = Date.now();
    let lastSegment = -1;
    let segmentCrossingCount = 0;
    let animationFrameId;

    function monitorSpin() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Cubic bezier easing function (0.1, 0.5, 0.1, 1)
        const easeProgress = cubicBezier(progress, 0.1, 0.5, 0.1, 1);
        const currentAngle = easeProgress * totalRotation;

        // Calculate which segment is currently at the pointer (top center)
        const pointerPosition = (3 * Math.PI) / 2; // 270 degrees (top)
        const normalizedAngle = (currentAngle % (2 * Math.PI));
        const segmentAtPointer = Math.floor(((pointerPosition - normalizedAngle + 2 * Math.PI) % (2 * Math.PI)) / anglePerSegment) % segments;

        if (segmentAtPointer !== lastSegment && lastSegment !== -1) {
            segmentCrossingCount++;
            // Play sound every 3rd segment crossing for less frequent ticks
            if (segmentCrossingCount % 3 === 0) {
                playTickSound();
            }
        }
        lastSegment = segmentAtPointer;

        if (progress < 1) {
            animationFrameId = requestAnimationFrame(monitorSpin);
        }
    }

    // Cubic bezier approximation for easing
    function cubicBezier(t, p1x, p1y, p2x, p2y) {
        const cx = 3 * p1x;
        const bx = 3 * (p2x - p1x) - cx;
        const ax = 1 - cx - bx;
        const cy = 3 * p1y;
        const by = 3 * (p2y - p1y) - cy;
        const ay = 1 - cy - by;

        function sampleCurveY(t) {
            return ((ay * t + by) * t + cy) * t;
        }

        return sampleCurveY(t);
    }

    animationFrameId = requestAnimationFrame(monitorSpin);

    setTimeout(() => {
        cancelAnimationFrame(animationFrameId);
        canvas.classList.remove('spinning');
        currentRotation = totalRotation % (2 * Math.PI);

        const finalDegrees = totalRotation * (180 / Math.PI);
        canvas.style.transform = `rotate(${finalDegrees}deg)`;

        isSpinning = false;

        if (isWin) {
            playWinSound();
        } else {
            playLoseSound();
        }

        setTimeout(() => {
            canvas.style.transform = '';
            drawWheel(currentRotation);
            wheelContainer.classList.remove('visible');
        }, 5000);
    }, duration);
}

function playWinSound() {
    winSound.currentTime = 0;
    winSound.play().catch(err => console.error('Could not play win sound:', err));
}

function playLoseSound() {
    loseSound.currentTime = 0;
    loseSound.play().catch(err => console.error('Could not play lose sound:', err));
}

let ws;
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('Connected to WebSocket server');
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'spin') {
            console.log('Received spin command:', data);
            spinWheel(data.isWin, 14000);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
        console.log('WebSocket connection closed. Reconnecting in 3 seconds...');
        setTimeout(connectWebSocket, 3000);
    };
}

connectWebSocket();

window.addEventListener('resize', () => {
    if (wheelContainer.classList.contains('visible')) {
        drawWheel(currentRotation);
    }
});
