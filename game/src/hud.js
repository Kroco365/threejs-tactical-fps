// The DOM HUD: crosshair, hit marker, health, ammo, timer, score, money, kill
// feed, bomb status, banners and the buy menu. It never touches the simulation;
// main.js pushes numbers in and reads callbacks out. Only changed text is
// written, so the DOM stays quiet during play.
const COPY = {
  start: {
    title: 'FOUNDRY PROTOCOL',
    copy: 'Round-based tactical FPS. Plant the spike at Furnace Hall or Cooling Yard — or eliminate EMBER. First to 5 rounds takes the match.',
    action: 'Click to play',
  },
  paused: {
    title: 'FOUNDRY PROTOCOL',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  roundEnd: { title: '', copy: '', action: 'Next round' },
  matchEnd: { title: '', copy: '', action: 'Play again' },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const vignette = $('damage-vignette');
  const dirIndicator = $('damage-dir');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const armorRow = $('armor-row');
  const armorNum = $('armor-num');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const grenadeNum = $('grenade-num');
  const timerEl = $('timer');
  const scoreEl = $('score');
  const moneyEl = $('money');
  const aliveUs = $('alive-us');
  const aliveThem = $('alive-them');
  const killfeed = $('killfeed');
  const bombEl = $('bomb-status');
  const bombText = $('bomb-text');
  const bombBar = $('bomb-bar');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const hintEl = $('hint');
  const buyMenu = $('buy-menu');
  const buyList = $('buy-list');
  const buyMoney = $('buy-money');
  let hitTimer = 0;
  let bannerTimer = 0;
  let hintTimer = 0;
  let last = {};
  let buyOpen = false;

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  return {
    setHealth(hp, armor) {
      const pct = Math.max(0, Math.min(100, hp));
      if (last.hp !== pct) {
        last.hp = pct;
        healthFill.style.width = `${pct}%`;
        healthFill.classList.toggle('low', pct <= 30);
        setText(healthNum, 'hpNum', String(pct));
      }
      if (last.armor !== armor) {
        last.armor = armor;
        armorRow.style.display = armor > 0 ? 'flex' : 'none';
        setText(armorNum, 'armorNum', String(armor));
      }
    },
    setAmmo(mag, reserve, name, grenades) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'reserve', reserve === Infinity ? '/ ∞' : `/ ${reserve}`);
      setText(weaponName, 'wname', name);
      setText(grenadeNum, 'nades', grenades > 0 ? `◉ ${grenades}` : '○ 0');
    },
    setMoney(money) {
      setText(moneyEl, 'money', `$${money}`);
      if (buyOpen) setText(buyMoney, 'buyMoney', `$${money}`);
    },
    setTimer(seconds, phase) {
      const s = Math.max(0, Math.ceil(seconds));
      const mm = Math.floor(s / 60);
      const ss = String(s % 60).padStart(2, '0');
      setText(timerEl, 'timer', phase === 'freeze' ? `BUY ${mm}:${ss}` : `${mm}:${ss}`);
      timerEl.classList.toggle('urgent', seconds <= 10 && phase === 'live');
    },
    setScore(winsUs, winsThem, round) {
      setText(scoreEl, 'score', `${winsUs} — ${winsThem} · ROUND ${round}`);
    },
    setAlive(us, them) {
      setText(aliveUs, 'aliveUs', '●'.repeat(us) + '○'.repeat(Math.max(0, 3 - us)));
      setText(aliveThem, 'aliveThem', '●'.repeat(them) + '○'.repeat(Math.max(0, 4 - them)));
    },
    setCrosshair(spreadPx, scoped) {
      crosshair.style.setProperty('--gap', `${Math.round(spreadPx)}px`);
      crosshair.classList.toggle('scoped', scoped);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash(angleDeg) {
      vignette.classList.add('on');
      setTimeout(() => vignette.classList.remove('on'), 220);
      if (angleDeg !== null && angleDeg !== undefined) {
        dirIndicator.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
        dirIndicator.classList.add('on');
        setTimeout(() => dirIndicator.classList.remove('on'), 450);
      }
    },
    killfeed(killer, victim, headshot, killerTeam) {
      const row = document.createElement('div');
      row.className = 'feed-row';
      const k = document.createElement('span');
      k.className = killerTeam === 'us' ? 'feed-us' : 'feed-them';
      k.textContent = killer;
      const w = document.createElement('span');
      w.className = 'feed-weapon';
      w.textContent = headshot ? ' ⌖ ' : ' ✕ ';
      const v = document.createElement('span');
      v.className = victim === 'YOU' ? 'feed-us' : 'feed-them';
      v.textContent = victim;
      row.append(k, w, v);
      killfeed.prepend(row);
      while (killfeed.children.length > 5) killfeed.lastChild.remove();
      setTimeout(() => row.remove(), 5000);
    },
    bombStatus(text, progress) {
      if (!text) {
        bombEl.hidden = true;
        return;
      }
      bombEl.hidden = false;
      setText(bombText, 'bombText', text);
      bombBar.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
    },
    banner(text, sub, holdMs = 3000) {
      bannerTitle.textContent = text;
      bannerSub.textContent = sub || '';
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        banner.hidden = true;
      }, holdMs);
    },
    hint(text, holdMs = 3000) {
      if (!text) {
        hintEl.hidden = true;
        return;
      }
      hintEl.textContent = text;
      hintEl.hidden = false;
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => {
        hintEl.hidden = true;
      }, holdMs);
    },
    showOverlay(mode, data = {}) {
      const text = COPY[mode] || COPY.start;
      title.textContent = data.title || text.title;
      copy.textContent = data.copy || text.copy;
      play.textContent = data.action || text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    showBuy(catalog, money, onBuy) {
      buyOpen = true;
      buyList.innerHTML = '';
      for (const item of catalog) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'buy-row';
        row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.name}</span><span class="buy-detail">${item.detail}</span><span class="buy-price">$${item.price}</span>`;
        row.addEventListener('click', () => onBuy(item.id));
        buyList.appendChild(row);
      }
      setText(buyMoney, 'buyMoney', `$${money}`);
      buyMenu.hidden = false;
    },
    hideBuy() {
      buyOpen = false;
      buyMenu.hidden = true;
    },
    isBuyOpen() {
      return buyOpen;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
