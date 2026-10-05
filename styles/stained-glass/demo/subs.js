// Subtitles as a parchment banderole (scroll ribbon) that unfurls from the centre.
// 这是**当前帧**（屏幕空间）的家什，不是相机里的世界：位置 ×FX/×FY、尺寸/线宽 ×S。
// 1920×1080 时 FX = FY = S = 1、W/2 = 960 ⇒ 与改造前逐字节相同。
import { clamp, ss, seg } from '/core/lib.js';
import { FX, FY, S } from './film.js';
export function drawBanderole(O, subs, t) {
  const s = subs.find(q => t >= q.t0 - .05 && t < q.t1 + .3); if (!s) return;
  const open = ss(seg(t, s.t0 - .05, s.t0 + .28)), close = 1 - ss(seg(t, s.t1, s.t1 + .28)), k = Math.min(open, close);
  if (k <= 0) return;
  O.save(); O.font = `${44 * S}px "IM Fell English"`;
  const tw = O.measureText(s.text).width, BW = (tw + 150 * S) * (.25 + .75 * k), BH = 64 * S, cx = 960 * FX, cy = 968 * FY;
  const x0 = cx - BW / 2, x1 = cx + BW / 2, sag = 7 * S;
  O.globalAlpha = clamp(k * 1.4);
  // curled ends (behind): darker folded parchment
  const end = (x, dir) => { O.fillStyle = '#b39a6c'; O.beginPath(); O.moveTo(x, cy - BH / 2 + 6 * S); O.lineTo(x + dir * 34 * S, cy - BH / 2 + 14 * S); O.lineTo(x + dir * 20 * S, cy); O.lineTo(x + dir * 34 * S, cy + BH / 2 + 10 * S); O.lineTo(x, cy + BH / 2 + 2 * S); O.closePath(); O.fill();
    O.fillStyle = '#8c7348'; O.beginPath(); O.ellipse(x + dir * 2 * S, cy + 4 * S, 6 * S, BH / 2 - 2 * S, 0, 0, 7); O.fill(); };
  end(x0 + 4 * S, -1); end(x1 - 4 * S, 1);
  // ribbon body with a gentle sag
  O.shadowColor = 'rgba(0,0,0,.45)'; O.shadowBlur = 14 * S; O.shadowOffsetY = 4 * S;
  O.beginPath(); O.moveTo(x0, cy - BH / 2); O.quadraticCurveTo(cx, cy - BH / 2 + sag, x1, cy - BH / 2); O.lineTo(x1, cy + BH / 2); O.quadraticCurveTo(cx, cy + BH / 2 + sag, x0, cy + BH / 2); O.closePath();
  const gr = O.createLinearGradient(0, cy - BH / 2, 0, cy + BH / 2); gr.addColorStop(0, '#f3e6c6'); gr.addColorStop(.5, '#ecdcb6'); gr.addColorStop(1, '#d9c497');
  O.fillStyle = gr; O.fill(); O.shadowColor = 'transparent';
  O.strokeStyle = 'rgba(110,80,40,.55)'; O.lineWidth = 1.5 * S; O.stroke();
  O.strokeStyle = 'rgba(140,40,30,.5)'; O.lineWidth = 1.2 * S; O.beginPath(); O.moveTo(x0 + 10 * S, cy - BH / 2 + 7 * S); O.quadraticCurveTo(cx, cy - BH / 2 + sag + 7 * S, x1 - 10 * S, cy - BH / 2 + 7 * S); O.moveTo(x0 + 10 * S, cy + BH / 2 - 6 * S); O.quadraticCurveTo(cx, cy + BH / 2 + sag - 6 * S, x1 - 10 * S, cy + BH / 2 - 6 * S); O.stroke();
  // text (clipped while unfurling)
  O.save(); O.beginPath(); O.rect(x0 + 8 * S, cy - BH, BW - 16 * S, BH * 2); O.clip();
  O.globalAlpha = clamp((k - .75) / .25);   // text appears only once the ribbon is (almost) fully open
  O.fillStyle = '#3a2412'; O.textAlign = 'center'; O.textBaseline = 'middle'; O.fillText(s.text, cx, cy + 5 * S);
  O.restore(); O.restore();
}
