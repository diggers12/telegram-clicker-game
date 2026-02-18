import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getDatabase, ref, set, get, child } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

// ============================================
// ECONOMY SCALING SYSTEM
// ============================================

function getProgressTier() {
    // Определяем "уровень прогресса" игрока на основе размера
    if (state.size < 500) return 1;
    if (state.size < 2000) return 2;
    if (state.size < 5000) return 3;
    if (state.size < 10000) return 4;
    if (state.size < 25000) return 5;
    if (state.size < 50000) return 6;
    if (state.size < 100000) return 7;
    return 8;
}

function getPriceMultiplier() {
    // Множитель цен на основе прогресса
    const tier = getProgressTier();
    const multipliers = [1, 1, 1.2, 1.5, 2, 3, 4.5, 7, 10];
    return multipliers[tier] || 1;
}

function getScaledPrice(basePrice) {
    return Math.floor(basePrice * getPriceMultiplier());
}

// ============================================
// CONFIG & STATE
// ============================================

const SHOP_REFRESH_MS = 24 * 60 * 60 * 1000;
const EXCHANGE_RATE = 3;
const SIZE_PER_LEVEL = 100;
const DAILY_REWARD_COOLDOWN = 24 * 60 * 60 * 1000; // 24 часа

// Firebase Configuration
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyB1ruI165WFEB-x0PxBK0-aTgz-bIR7kuY",
    authDomain: "sisya-clicker.firebaseapp.com",
    databaseURL: "https://sisya-clicker-default-rtdb.firebaseio.com",
    projectId: "sisya-clicker",
    storageBucket: "sisya-clicker.firebasestorage.app",
    messagingSenderId: "657572523974",
    appId: "1:657572523974:web:a43b0fa0dbf18138e14cc7",
    measurementId: "G-FS3BR77SYR"
};

const DAILY_REWARDS = [
    // Обычные (70% шанс)
    { id: 'small_mult', name: 'Буст x2', desc: 'x2 к клику на 5 минут', icon: '⚡', rarity: 'common', weight: 30, effect: { type: 'multiply', value: 2 }, duration: 300000, color: '#4ade80' },
    { id: 'small_size', name: 'Размер +50', desc: 'Небольшая прибавка', icon: '📏', rarity: 'common', weight: 25, effect: { type: 'instantSizePercent', value: 0.05 }, duration: 0, color: '#60a5fa' },
    { id: 'small_coins', name: 'Монеты', desc: '+5% от текущих', icon: '💰', rarity: 'common', weight: 15, effect: { type: 'instantCoinsPercent', value: 0.05 }, duration: 0, color: '#fcd34d' },
    
    // Редкие (20% шанс)
    { id: 'medium_mult', name: 'Усилитель x5', desc: 'x5 к клику на 10 минут', icon: '💸', rarity: 'rare', weight: 10, effect: { type: 'multiply', value: 5 }, duration: 600000, color: '#b366ff' },
    { id: 'medium_auto', name: 'Авто-клик', desc: '2 клика/сек на 10 минут', icon: '🤖', rarity: 'rare', weight: 8, effect: { type: 'autoclick', value: 2 }, duration: 600000, color: '#8b5cf6' },
    { id: 'medium_size', name: 'Размер +10%', desc: 'От текущего размера', icon: '📐', rarity: 'rare', weight: 2, effect: { type: 'instantSizePercent', value: 0.10 }, duration: 0, color: '#3b82f6' },
    
    // Эпические (8% шанс)
    { id: 'epic_mult', name: 'Мега x10', desc: 'x10 к клику на 15 минут', icon: '💫', rarity: 'epic', weight: 4, effect: { type: 'multiply', value: 10 }, duration: 900000, color: '#fbbf24' },
    { id: 'epic_size', name: 'Размер +20%', desc: 'Большая прибавка', icon: '💎', rarity: 'epic', weight: 3, effect: { type: 'instantSizePercent', value: 0.20 }, duration: 0, color: '#10b981' },
    { id: 'epic_coins', name: 'Монеты +15%', desc: 'От текущих монет', icon: '💸', rarity: 'epic', weight: 1, effect: { type: 'instantCoinsPercent', value: 0.15 }, duration: 0, color: '#f59e0b' },
    
    // Легендарные (2% шанс)
    { id: 'legend_mult', name: 'УЛЬТРА x20', desc: 'x20 к клику на 20 минут', icon: '🌟', rarity: 'legendary', weight: 1, effect: { type: 'multiply', value: 20 }, duration: 1200000, color: '#ff4d8d' },
    { id: 'legend_auto', name: 'Авто-клик МАКС', desc: '5 кликов/сек на 15 минут', icon: '⚡', rarity: 'legendary', weight: 0.5, effect: { type: 'autoclick', value: 5 }, duration: 900000, color: '#ec4899' },
    { id: 'legend_jackpot', name: 'ДЖЕКПОТ', desc: '+30% размера и монет', icon: '👑', rarity: 'legendary', weight: 0.5, effect: { type: 'jackpot', value: 0.30 }, duration: 0, color: '#fbbf24' },
];

let state = {
    coins: 0,
    size: 0,
    stars: 0,
    totalClicks: 0,
    totalPlayTime: 0,
    inventory: [],
    activeEffects: [],
    unlockedAchievements: [],
    statsCases: 0,
    statsExchanges: 0,
    statsBuffsUsed: 0,
    upgrades: {},
    userId: 'local_' + Math.random().toString(36).substr(2, 9),
    userName: 'Игрок',
    shopLastUpdate: Date.now(),
    dailyRewardLastClaim: 0,
    dailyRewardStreak: 0
};

// ============================================
// ANTI-AUTOCLICKER SYSTEM
// ============================================

let antiCheat = null;

// ============================================
// UPGRADES SYSTEM
// ============================================

const UPGRADES = [
    {
        id: 'click_power',
        name: 'Сила клика',
        desc: 'Увеличивает базовый клик',
        icon: '👆',
        color: '#ff4d8d',
        category: 'click',
        maxLevel: 50,
        costType: 'size',
        baseCost: 50,
        costScale: 1.8,
        costExponent: 1.15,
        effect: (lvl) => ({ clickBonus: lvl * 1 }),
        effectDesc: (lvl) => `+${lvl} к базовому клику`
    },
    {
        id: 'click_multi',
        name: 'Мультипликатор',
        desc: 'Множитель силы клика',
        icon: '✖️',
        color: '#b366ff',
        category: 'click',
        maxLevel: 25,
        costType: 'size',
        baseCost: 500,
        costScale: 2.5,
        costExponent: 1.25,
        effect: (lvl) => ({ clickMulti: 1 + lvl * 0.15 }),
        effectDesc: (lvl) => `x${(1 + lvl * 0.15).toFixed(2)} к клику`
    },
    {
        id: 'critical_chance',
        name: 'Крит. шанс',
        desc: 'Шанс критического клика (x5)',
        icon: '💥',
        color: '#f59e0b',
        category: 'click',
        maxLevel: 20,
        costType: 'size',
        baseCost: 1000,
        costScale: 3.0,
        costExponent: 1.3,
        effect: (lvl) => ({ critChance: lvl * 0.02 }),
        effectDesc: (lvl) => `${(lvl * 2)}% шанс крита`
    },
    {
        id: 'auto_clicker',
        name: 'Авто-кликер',
        desc: 'Пассивный рост размера в секунду',
        icon: '🤖',
        color: '#4ade80',
        category: 'passive',
        maxLevel: 30,
        costType: 'size',
        baseCost: 2000,
        costScale: 2.8,
        costExponent: 1.22,
        effect: (lvl) => ({ autoPerSec: lvl }),
        effectDesc: (lvl) => `+${lvl}/сек автоматически`
    },
    {
        id: 'exchange_rate',
        name: 'Курс обмена',
        desc: 'Улучшает курс размер → монеты',
        icon: '💱',
        color: '#fcd34d',
        category: 'economy',
        maxLevel: 20,
        costType: 'size',
        baseCost: 3000,
        costScale: 3.5,
        costExponent: 1.35,
        effect: (lvl) => ({ exchangeBonus: lvl * 1 }),
        effectDesc: (lvl) => `+${lvl} к курсу обмена (=${3 + lvl})`
    },
    {
        id: 'coin_magnet',
        name: 'Монетный магнит',
        desc: 'Шанс получить монеты при клике',
        icon: '🧲',
        color: '#60a5fa',
        category: 'economy',
        maxLevel: 15,
        costType: 'coins',
        baseCost: 5000,
        costScale: 4.0,
        costExponent: 1.4,
        effect: (lvl) => ({ coinChance: lvl * 0.03, coinAmount: Math.ceil(lvl * 2) }),
        effectDesc: (lvl) => `${(lvl * 3)}% шанс +${Math.ceil(lvl * 2)} монет/клик`
    },
    {
        id: 'level_speed',
        name: 'Скорость уровня',
        desc: 'Уменьшает размер для уровня',
        icon: '⚡',
        color: '#8b5cf6',
        category: 'passive',
        maxLevel: 10,
        costType: 'size',
        baseCost: 5000,
        costScale: 5.0,
        costExponent: 1.5,
        effect: (lvl) => ({ levelReduction: lvl * 5 }),
        effectDesc: (lvl) => `-${lvl * 5} к размеру для уровня`
    },
    {
        id: 'lucky_star',
        name: 'Счастливая звезда',
        desc: 'Шанс получить x10 от клика',
        icon: '⭐',
        color: '#ff6b6b',
        category: 'click',
        maxLevel: 10,
        costType: 'coins',
        baseCost: 50000,
        costScale: 5.5,
        costExponent: 1.55,
        effect: (lvl) => ({ luckyChance: lvl * 0.005 }),
        effectDesc: (lvl) => `${(lvl * 0.5).toFixed(1)}% шанс x10`
    },
    {
        id: 'prestige_power',
        name: 'Престижная мощь',
        desc: 'Пассивный множитель силы клика',
        icon: '👑',
        color: '#ffd700',
        category: 'click',
        maxLevel: 15,
        costType: 'size',
        baseCost: 10000,
        costScale: 4.0,
        costExponent: 1.45,
        effect: (lvl) => ({ prestigeMulti: 1 + lvl * 0.2 }),
        effectDesc: (lvl) => `x${(1 + lvl * 0.2).toFixed(1)} к клику`
    },
    {
        id: 'diamond_touch',
        name: 'Алмазное касание',
        desc: 'Супер-множитель для всего',
        icon: '💎',
        color: '#00ffff',
        category: 'click',
        maxLevel: 5,
        costType: 'size',
        baseCost: 100000,
        costScale: 10.0,
        costExponent: 2.0,
        effect: (lvl) => ({ globalMulti: 1 + lvl * 0.5 }),
        effectDesc: (lvl) => `x${(1 + lvl * 0.5).toFixed(1)} ко всему`
    }
];

function getUpgradeLevel(id) {
    return state.upgrades[id] || 0;
}

function getUpgradeCost(upgrade) {
    const lvl = getUpgradeLevel(upgrade.id);
    if (lvl >= upgrade.maxLevel) return Infinity;
    const baseCost = Math.floor(upgrade.baseCost * Math.pow(upgrade.costScale, lvl) * Math.pow(lvl + 1, upgrade.costExponent));
    
    // Применяем масштабирование только к апгрейдам за размер
    if (upgrade.costType === 'size') {
        return getScaledPrice(baseCost);
    }
    return baseCost;
}

function getUpgradeEffect(id) {
    const upgrade = UPGRADES.find(u => u.id === id);
    if (!upgrade) return {};
    const lvl = getUpgradeLevel(id);
    return lvl > 0 ? upgrade.effect(lvl) : {};
}

function getAllUpgradeEffects() {
    const combined = {
        clickBonus: 0,
        clickMulti: 1,
        prestigeMulti: 1,
        critChance: 0,
        critBoost: 0,
        autoPerSec: 0,
        exchangeBonus: 0,
        coinChance: 0,
        coinAmount: 0,
        levelReduction: 0,
        luckyChance: 0,
        globalMulti: 1
    };

    UPGRADES.forEach(u => {
        const eff = getUpgradeEffect(u.id);
        Object.keys(eff).forEach(key => {
            if (key === 'clickMulti' || key === 'prestigeMulti' || key === 'globalMulti') {
                combined[key] *= eff[key];
            } else {
                combined[key] = (combined[key] || 0) + (eff[key] || 0);
            }
        });
    });

    // Активные эффекты из магазина/кейсов
    const now = Date.now();
    state.activeEffects.forEach(e => {
        if (e.endTime > now) {
            if (e.effect.type === 'critBoost') {
                combined.critBoost = Math.max(combined.critBoost, e.effect.value);
            }
        }
    });

    return combined;
}

function buyUpgrade(upgrade) {
    const lvl = getUpgradeLevel(upgrade.id);
    if (lvl >= upgrade.maxLevel) return showToast('Максимальный уровень!', 'error');
    
    const cost = getUpgradeCost(upgrade);
    
    if (upgrade.costType === 'size') {
        if (state.size < cost) return showToast(`Нужно ${cost.toLocaleString()} размера!`, 'error');
        state.size -= cost;
        updateTargetScale();
    } else {
        if (state.coins < cost) return showToast(`Нужно ${cost.toLocaleString()} монет!`, 'error');
        state.coins -= cost;
    }
    
    state.upgrades[upgrade.id] = lvl + 1;
    playSound('buy');
    
    const newEffect = upgrade.effect(lvl + 1);
    showToast(`${upgrade.name} → Ур.${lvl + 1}!`, 'success');
    
    renderUpgrades();
    updateUI();
    saveState();
}

function renderUpgrades() {
    const grid = els.upgradeGrid;
    grid.innerHTML = '';
    
    const categories = {
        click: 'Клик',
        passive: 'Пассивные',
        economy: 'Экономика'
    };
    
    const grouped = {};
    UPGRADES.forEach(u => {
        if (!grouped[u.category]) grouped[u.category] = [];
        grouped[u.category].push(u);
    });
    
    Object.keys(categories).forEach(cat => {
        if (!grouped[cat]) return;
        
        const catLabel = document.createElement('div');
        catLabel.className = 'upgrade-category';
        catLabel.textContent = categories[cat];
        grid.appendChild(catLabel);
        
        grouped[cat].forEach(upgrade => {
            const lvl = getUpgradeLevel(upgrade.id);
            const cost = getUpgradeCost(upgrade);
            const isMaxed = lvl >= upgrade.maxLevel;
            const effects = getAllUpgradeEffects();
            
            const canAfford = upgrade.costType === 'size' 
                ? state.size >= cost 
                : state.coins >= cost;
            
            const card = document.createElement('div');
            card.className = `upgrade-card ${isMaxed ? 'maxed' : ''}`;
            
            const progressPct = (lvl / upgrade.maxLevel) * 100;
            const progressColor = upgrade.color;
            
            card.innerHTML = `
                <div class="upgrade-top">
                    <div class="upgrade-icon" style="background: ${upgrade.color}20; color: ${upgrade.color}; border: 2px solid ${upgrade.color}40;">
                        ${upgrade.icon}
                    </div>
                    <div class="upgrade-info">
                        <div class="upgrade-name">${upgrade.name}</div>
                        <div class="upgrade-desc">${upgrade.desc}</div>
                        <div class="upgrade-level-badge">Уровень ${lvl}/${upgrade.maxLevel}</div>
                        ${lvl > 0 ? `<div class="upgrade-effect-preview">✓ ${upgrade.effectDesc(lvl)}</div>` : ''}
                    </div>
                </div>
                <div class="upgrade-bottom">
                    <div class="upgrade-cost">
                        <div class="upgrade-cost-label">${isMaxed ? 'МАКС' : 'Цена'}</div>
                        <div class="upgrade-cost-value ${upgrade.costType === 'coins' ? 'coins-cost' : ''}">
                            ${isMaxed ? '—' : (upgrade.costType === 'size' ? '📏 ' : '💰 ') + cost.toLocaleString()}
                        </div>
                    </div>
                    <div class="upgrade-progress-bar">
                        <div class="upgrade-progress-fill" style="width: ${progressPct}%; background: ${upgrade.color};"></div>
                    </div>
                    <button class="upgrade-buy-btn ${upgrade.costType === 'size' ? 'size-btn' : 'coins-btn'}" 
                            ${isMaxed || !canAfford ? 'disabled' : ''}>
                        ${isMaxed ? 'МАКС' : 'Купить'}
                    </button>
                </div>
            `;
            
            if (!isMaxed) {
                card.querySelector('.upgrade-buy-btn').addEventListener('click', () => {
                    window.haptic('medium');
                    buyUpgrade(upgrade);
                });
            }
            
            grid.appendChild(card);
        });
    });
}

// Data
const ACHIEVEMENTS = [
    { id: 'click1', name: 'Первый шаг', desc: 'Сделай первый клик', icon: '1', condition: s => s.totalClicks >= 1 },
    { id: 'size10', name: 'Начало', desc: 'Размер 10', icon: 'S', condition: s => s.size >= 10 },
    { id: 'click100', name: 'Старательный', desc: '100 кликов', icon: 'C', condition: s => s.totalClicks >= 100 },
    { id: 'size100', name: 'Заметный', desc: 'Размер 100', icon: 'S', condition: s => s.size >= 100 },
    { id: 'time10m', name: 'Игрок', desc: 'Играй 10 минут', icon: 'T', condition: s => s.totalPlayTime >= 600000 },
    { id: 'click1000', name: 'Мастер клика', desc: '1000 кликов', icon: 'M', condition: s => s.totalClicks >= 1000 },
    { id: 'size1000', name: 'Грандиозный', desc: 'Размер 1000', icon: 'S', condition: s => s.size >= 1000 },
    { id: 'coins10k', name: 'Богач', desc: '10,000 монет', icon: '$', condition: s => s.coins >= 10000 },
    { id: 'case10', name: 'Азартный', desc: 'Открой 10 кейсов', icon: '?', condition: s => s.statsCases >= 10 },
    { id: 'click5000', name: 'Легенда клика', desc: '5000 кликов', icon: 'L', condition: s => s.totalClicks >= 5000 },
    { id: 'size5000', name: 'Идеал', desc: 'Размер 5000', icon: 'S', condition: s => s.size >= 5000 },
    { id: 'time1h', name: 'Преданный', desc: 'Играй 1 час', icon: 'T', condition: s => s.totalPlayTime >= 3600000 },
    { id: 'case50', name: 'Охотник', desc: 'Открой 50 кейсов', icon: '?', condition: s => s.statsCases >= 50 },
    { id: 'click10000', name: 'Клик-машина', desc: '10,000 кликов', icon: '!', condition: s => s.totalClicks >= 10000 },
    { id: 'size10000', name: 'Богиня', desc: 'Размер 10,000', icon: 'G', condition: s => s.size >= 10000 },
    { id: 'coins1m', name: 'Миллионер', desc: '1,000,000 монет', icon: '$$', condition: s => s.coins >= 1000000 },
    { id: 'time10h', name: 'Затяжной', desc: 'Играй 10 часов', icon: 'TT', condition: s => s.totalPlayTime >= 36000000 },
    { id: 'exchange100', name: 'Торговец', desc: 'Обменяй 100 размера', icon: 'E', condition: s => s.statsExchanges >= 100 },
    { id: 'buff10', name: 'Химик', desc: 'Используй 10 баффов', icon: 'B', condition: s => s.statsBuffsUsed >= 10 },
    { id: 'level10', name: 'Опытный', desc: 'Достигни 10 уровня', icon: 'Lv', condition: s => getLevel() >= 10 },
    { id: 'upgrade5', name: 'Апгрейдер', desc: 'Купи 5 апгрейдов', icon: '⬆', condition: s => Object.values(s.upgrades).reduce((a, b) => a + b, 0) >= 5 },
    { id: 'upgrade20', name: 'Мастер прокачки', desc: 'Купи 20 апгрейдов', icon: '🔝', condition: s => Object.values(s.upgrades).reduce((a, b) => a + b, 0) >= 20 },
    
    // Дополнительные достижения
    { id: 'click10', name: 'Новичок', desc: 'Сделай 10 кликов', icon: '👋', condition: s => s.totalClicks >= 10 },
    { id: 'click50', name: 'Активный', desc: 'Сделай 50 кликов', icon: '👏', condition: s => s.totalClicks >= 50 },
    { id: 'click500', name: 'Упорный', desc: 'Сделай 500 кликов', icon: '🔥', condition: s => s.totalClicks >= 500 },
    { id: 'click2500', name: 'Профи', desc: 'Сделай 2500 кликов', icon: '💫', condition: s => s.totalClicks >= 2500 },
    { id: 'click25000', name: 'Бог кликов', desc: 'Сделай 25,000 кликов', icon: '👑', condition: s => s.totalClicks >= 25000 },
    { id: 'click50000', name: 'Абсолют', desc: 'Сделай 50,000 кликов', icon: '💎', condition: s => s.totalClicks >= 50000 },
    { id: 'click100000', name: 'Бесконечность', desc: 'Сделай 100,000 кликов', icon: '♾️', condition: s => s.totalClicks >= 100000 },
    
    { id: 'size50', name: 'Растущий', desc: 'Достигни размера 50', icon: '🌿', condition: s => s.size >= 50 },
    { id: 'size500', name: 'Внушительный', desc: 'Достигни размера 500', icon: '🏔️', condition: s => s.size >= 500 },
    { id: 'size2500', name: 'Колоссальный', desc: 'Достигни размера 2500', icon: '🌋', condition: s => s.size >= 2500 },
    { id: 'size25000', name: 'Титан', desc: 'Достигни размера 25,000', icon: '🦾', condition: s => s.size >= 25000 },
    { id: 'size50000', name: 'Гигант', desc: 'Достигни размера 50,000', icon: '🗿', condition: s => s.size >= 50000 },
    { id: 'size100000', name: 'Вселенная', desc: 'Достигни размера 100,000', icon: '🌌', condition: s => s.size >= 100000 },
    { id: 'size500000', name: 'Мультивселенная', desc: 'Достигни размера 500,000', icon: '🌠', condition: s => s.size >= 500000 },
    { id: 'size1000000', name: 'Бесконечность', desc: 'Достигни размера 1,000,000', icon: '✨', condition: s => s.size >= 1000000 },
    
    { id: 'coins100', name: 'Копилка', desc: 'Собери 100 монет', icon: '🪙', condition: s => s.coins >= 100 },
    { id: 'coins1000', name: 'Сбережения', desc: 'Собери 1,000 монет', icon: '💰', condition: s => s.coins >= 1000 },
    { id: 'coins50k', name: 'Состоятельный', desc: 'Собери 50,000 монет', icon: '💸', condition: s => s.coins >= 50000 },
    { id: 'coins100k', name: 'Магнат', desc: 'Собери 100,000 монет', icon: '🤑', condition: s => s.coins >= 100000 },
    { id: 'coins500k', name: 'Олигарх', desc: 'Собери 500,000 монет', icon: '💎', condition: s => s.coins >= 500000 },
    
    { id: 'time5m', name: 'Любопытный', desc: 'Играй 5 минут', icon: '⏱️', condition: s => s.totalPlayTime >= 300000 },
    { id: 'time30m', name: 'Увлеченный', desc: 'Играй 30 минут', icon: '🕐', condition: s => s.totalPlayTime >= 1800000 },
    { id: 'time3h', name: 'Фанат', desc: 'Играй 3 часа', icon: '🕒', condition: s => s.totalPlayTime >= 10800000 },
    { id: 'time24h', name: 'Марафонец', desc: 'Играй 24 часа', icon: '🏃', condition: s => s.totalPlayTime >= 86400000 },
    
    { id: 'case1', name: 'Первый кейс', desc: 'Открой первый кейс', icon: '📦', condition: s => s.statsCases >= 1 },
    { id: 'case5', name: 'Везунчик', desc: 'Открой 5 кейсов', icon: '🎁', condition: s => s.statsCases >= 5 },
    { id: 'case25', name: 'Коллекционер', desc: 'Открой 25 кейсов', icon: '🎰', condition: s => s.statsCases >= 25 },
    { id: 'case100', name: 'Зависимый', desc: 'Открой 100 кейсов', icon: '🎪', condition: s => s.statsCases >= 100 },
    
    { id: 'exchange1', name: 'Первый обмен', desc: 'Обменяй размер на монеты', icon: '🔄', condition: s => s.statsExchanges >= 1 },
    { id: 'exchange10', name: 'Меняла', desc: 'Сделай 10 обменов', icon: '💱', condition: s => s.statsExchanges >= 10 },
    { id: 'exchange50', name: 'Биржевик', desc: 'Сделай 50 обменов', icon: '📈', condition: s => s.statsExchanges >= 50 },
    
    { id: 'buff1', name: 'Первый бафф', desc: 'Используй первый бафф', icon: '⚗️', condition: s => s.statsBuffsUsed >= 1 },
    { id: 'buff5', name: 'Алхимик', desc: 'Используй 5 баффов', icon: '🧪', condition: s => s.statsBuffsUsed >= 5 },
    { id: 'buff25', name: 'Зельевар', desc: 'Используй 25 баффов', icon: '🧙', condition: s => s.statsBuffsUsed >= 25 },
    
    { id: 'level5', name: 'Новичок', desc: 'Достигни 5 уровня', icon: '5️⃣', condition: s => getLevel() >= 5 },
    { id: 'level20', name: 'Ветеран', desc: 'Достигни 20 уровня', icon: '2️⃣0️⃣', condition: s => getLevel() >= 20 },
    { id: 'level30', name: 'Эксперт', desc: 'Достигни 30 уровня', icon: '3️⃣0️⃣', condition: s => getLevel() >= 30 },
    { id: 'level50', name: 'Мастер', desc: 'Достигни 50 уровня', icon: '5️⃣0️⃣', condition: s => getLevel() >= 50 },
    { id: 'level100', name: 'Легенда', desc: 'Достигни 100 уровня', icon: '💯', condition: s => getLevel() >= 100 },
    
    { id: 'upgrade1', name: 'Первый апгрейд', desc: 'Купи первый апгрейд', icon: '⬆️', condition: s => Object.values(s.upgrades).reduce((a, b) => a + b, 0) >= 1 },
    { id: 'upgrade10', name: 'Оптимизатор', desc: 'Купи 10 апгрейдов', icon: '📈', condition: s => Object.values(s.upgrades).reduce((a, b) => a + b, 0) >= 10 },
    { id: 'upgrade50', name: 'Максималист', desc: 'Купи 50 апгрейдов', icon: '🚀', condition: s => Object.values(s.upgrades).reduce((a, b) => a + b, 0) >= 50 },
    { id: 'upgrade100', name: 'Перфекционист', desc: 'Купи 100 апгрейдов', icon: '✨', condition: s => Object.values(s.upgrades).reduce((a, b) => a + b, 0) >= 100 },
    
    { id: 'daily1', name: 'Ежедневник', desc: 'Получи ежедневную награду', icon: '📅', condition: s => s.dailyStreak >= 1 },
    { id: 'daily7', name: 'Неделя', desc: 'Серия 7 дней', icon: '📆', condition: s => s.dailyStreak >= 7 },
    { id: 'daily30', name: 'Месяц', desc: 'Серия 30 дней', icon: '🗓️', condition: s => s.dailyStreak >= 30 },
    { id: 'speedster', name: 'Спидранер', desc: 'Достигни размера 1000 за 10 минут', icon: '⚡', condition: s => s.size >= 1000 && s.totalPlayTime <= 600000 },
    { id: 'patient', name: 'Терпеливый', desc: 'Играй без кликов 5 минут', icon: '🧘', condition: s => s.totalPlayTime >= 300000 && s.totalClicks === 0 },
];

const SHOP_DB = [
    { id: 'mult2', name: 'Усилитель x2', desc: 'Двойной рост на 10 мин', icon: '2x', price: 5000, color: '#4ade80', type: 'boost', effect: { type: 'multiply', value: 2 }, duration: 600000 },
    { id: 'shield', name: 'Щит', desc: 'Блок дебаффа', icon: '🛡️', price: 10000, color: '#60a5fa', type: 'shield', effect: { type: 'shield', value: 1 }, duration: 0 },
    { id: 'size100', name: 'Размер +100', desc: 'Мгновенно', icon: '+', price: 15000, color: '#ff4d8d', type: 'instant', effect: { type: 'instantSize', value: 100 }, duration: 0 },
    { id: 'auto', name: 'Авто-рост', desc: '1 клик/сек на 10 мин', icon: '🤖', price: 30000, color: '#b366ff', type: 'ability', effect: { type: 'autoclick', value: 1 }, duration: 600000 },
    { id: 'mult5', name: 'Усилитель x5', desc: 'Мощный буст на 5 мин', icon: '5x', price: 80000, color: '#fbbf24', type: 'boost', effect: { type: 'multiply', value: 5 }, duration: 300000 },
    { id: 'auto2', name: 'Авто-рост PRO', desc: '2 клика/сек на 10 мин', icon: '⚡', price: 100000, color: '#b366ff', type: 'ability', effect: { type: 'autoclick', value: 2 }, duration: 600000 },
    { id: 'frenzy', name: 'Френзи x10', desc: 'Бешеный рост на 3 мин', icon: '🌪️', price: 200000, color: '#ff4d8d', type: 'boost', effect: { type: 'multiply', value: 10 }, duration: 180000 },
];

const CASES = [
    { id: 'star1', name: 'Новичок', desc: '1 звезда', price: 1, icon: '📦', rarity: 'common', currency: 'stars' },
    { id: 'star2', name: 'Удачливый', desc: '2 звезды', price: 2, icon: '🎁', rarity: 'rare', currency: 'stars' },
    { id: 'star3', name: 'Легенда', desc: '3 звезды', icon: '🎰', rarity: 'epic', currency: 'stars', price: 3 }
];

const CASE_REWARDS = [
    // Common награды (для кейса за 1 звезду) - слабые бусты
    { id: 'mult2_1min', name: 'x2 на 1 мин', icon: '2x', rarity: 'common', weight: 30, type: 'boost', effect: { type: 'multiply', value: 2 }, duration: 60000 },
    { id: 'mult1_5_3min', name: 'x1.5 на 3 мин', icon: '1.5x', rarity: 'common', weight: 25, type: 'boost', effect: { type: 'multiply', value: 1.5 }, duration: 180000 },
    { id: 'auto1_2min', name: 'Авто-клик 1 на 2 мин', icon: '🤖', rarity: 'common', weight: 20, type: 'boost', effect: { type: 'autoclick', value: 1 }, duration: 120000 },
    { id: 'empty_common', name: 'Пусто', icon: '💨', rarity: 'common', weight: 25, type: 'empty', effect: {} },
    
    // Rare награды (для кейса за 2 звезды) - средние бусты
    { id: 'mult3_3min', name: 'x3 на 3 мин', icon: '3x', rarity: 'rare', weight: 25, type: 'boost', effect: { type: 'multiply', value: 3 }, duration: 180000 },
    { id: 'mult2_5min', name: 'x2 на 5 мин', icon: '2x', rarity: 'rare', weight: 22, type: 'boost', effect: { type: 'multiply', value: 2 }, duration: 300000 },
    { id: 'auto2_3min', name: 'Авто-клик 2 на 3 мин', icon: '⚡', rarity: 'rare', weight: 18, type: 'boost', effect: { type: 'autoclick', value: 2 }, duration: 180000 },
    { id: 'crit_5min', name: 'Крит 20% на 5 мин', icon: '💥', rarity: 'rare', weight: 15, type: 'boost', effect: { type: 'critBoost', value: 0.2 }, duration: 300000 },
    { id: 'empty_rare', name: 'Пусто', icon: '💨', rarity: 'rare', weight: 20, type: 'empty', effect: {} },
    
    // Epic награды (для кейса за 3 звезды) - сильные бусты
    { id: 'mult5_5min', name: 'x5 на 5 мин', icon: '5x', rarity: 'epic', weight: 22, type: 'boost', effect: { type: 'multiply', value: 5 }, duration: 300000 },
    { id: 'mult3_10min', name: 'x3 на 10 мин', icon: '3x', rarity: 'epic', weight: 18, type: 'boost', effect: { type: 'multiply', value: 3 }, duration: 600000 },
    { id: 'auto3_5min', name: 'Авто-клик 3 на 5 мин', icon: '⚡', rarity: 'epic', weight: 18, type: 'boost', effect: { type: 'autoclick', value: 3 }, duration: 300000 },
    { id: 'auto5_3min', name: 'Авто-клик 5 на 3 мин', icon: '⚡', rarity: 'epic', weight: 15, type: 'boost', effect: { type: 'autoclick', value: 5 }, duration: 180000 },
    { id: 'crit_30_5min', name: 'Крит 30% на 5 мин', icon: '💥', rarity: 'epic', weight: 12, type: 'boost', effect: { type: 'critBoost', value: 0.3 }, duration: 300000 },
    { id: 'empty_epic', name: 'Пусто', icon: '💨', rarity: 'epic', weight: 15, type: 'empty', effect: {} },
    
    // Legendary награды (очень редко из любого кейса) - мощные бусты
    { id: 'mult10_3min', name: 'x10 на 3 мин', icon: '🔥', rarity: 'legendary', weight: 10, type: 'boost', effect: { type: 'multiply', value: 10 }, duration: 180000 },
    { id: 'mult5_10min', name: 'x5 на 10 мин', icon: '5x', rarity: 'legendary', weight: 8, type: 'boost', effect: { type: 'multiply', value: 5 }, duration: 600000 },
    { id: 'auto10_5min', name: 'Авто-клик 10 на 5 мин', icon: '⚡⚡', rarity: 'legendary', weight: 8, type: 'boost', effect: { type: 'autoclick', value: 10 }, duration: 300000 },
    { id: 'jackpot_boost', name: 'ВСЁ ПО МАКСИМУМУ', icon: '👑', rarity: 'legendary', weight: 5, type: 'boost', effect: { type: 'multiply', value: 20 }, duration: 120000 },
    { id: 'empty_legendary', name: 'Пусто', icon: '💨', rarity: 'legendary', weight: 9, type: 'empty', effect: {} }
];

const RARITY = {
    common: { bg: '#3a3a4a', border: '#5a5a6a', cls: 'RARITY-COMMON' },
    rare: { bg: 'linear-gradient(135deg, #b366ff, #8b5cf6)', border: '#b366ff', cls: 'RARITY-RARE' },
    epic: { bg: 'linear-gradient(135deg, #fbbf24, #f59e0b)', border: '#fbbf24', cls: 'RARITY-EPIC' },
    legendary: { bg: 'linear-gradient(135deg, #ff4d8d, #f43f5e)', border: '#ff4d8d', cls: 'RARITY-LEGENDARY' }
};

// Здесь будут данные других игроков из Firebase
let LEADERBOARD_DATA = [];
let firebaseDB = null;
let firebaseApp = null;

// Инициализация Firebase
function initFirebase() {
    try {
        firebaseApp = initializeApp(FIREBASE_CONFIG);
        firebaseDB = getDatabase(firebaseApp);
        console.log('✅ Firebase подключен');
    } catch (error) {
        console.error('❌ Ошибка подключения Firebase:', error);
    }
}

// Функция для получения топа игроков из Firebase
async function fetchLeaderboard() {
    console.log('🔄 [fetchLeaderboard] Начало загрузки...');
    
    if (!firebaseDB) {
        console.error('❌ Firebase не инициализирован');
        return [];
    }
    
    try {
        console.log('� Отправка запроса к Firebase...');
        const dbRef = ref(firebaseDB);
        const snapshot = await get(child(dbRef, 'players'));
        
        console.log('� Получен snapshot:', snapshot);
        console.log('📦 snapshot.exists():', snapshot.exists());
        
        if (!snapshot.exists()) {
            console.warn('📭 Нет данных в Firebase (snapshot.exists() = false)');
            return [];
        }
        
        const playersData = snapshot.val();
        console.log('📊 Данные из Firebase:', playersData);
        console.log('📊 Количество ключей:', Object.keys(playersData || {}).length);
        
        const players = [];
        
        for (const userId in playersData) {
            const player = playersData[userId];
            console.log(`👤 Игрок ${userId}:`, player);
            players.push({
                userId: userId,
                name: player.name || 'Игрок',
                size: player.size || 0,
                coins: player.coins || 0,
                time: player.time || 0,
                achievements: player.achievements || [],
                photoUrl: player.photoUrl || null // Добавляем фото
            });
        }
        
        // Сортируем по размеру (от большего к меньшему)
        players.sort((a, b) => b.size - a.size);
        
        LEADERBOARD_DATA = players;
        console.log(`✅ Загружено игроков: ${players.length}`);
        if (players.length > 0) {
            console.log('🏆 Топ-3:', players.slice(0, 3).map(p => `${p.name}: ${p.size}`));
        }
        return players;
        
    } catch (error) {
        console.error('❌ Ошибка загрузки топа:', error);
        console.error('❌ Детали ошибки:', error.message);
        console.error('❌ Stack:', error.stack);
        return [];
    }
}

// Функция для отправки своей статистики в Firebase
async function syncPlayerData() {
    if (!firebaseDB) {
        console.log('Firebase не инициализирован');
        return;
    }
    
    try {
        // Получаем фото профиля из Telegram
        const tg = window.Telegram?.WebApp;
        let photoUrl = null;
        
        if (tg && tg.initDataUnsafe?.user?.photo_url) {
            photoUrl = tg.initDataUnsafe.user.photo_url;
        }
        
        const playerData = {
            name: state.userName,
            size: state.size,
            coins: state.coins,
            time: state.totalPlayTime,
            achievements: state.unlockedAchievements,
            photoUrl: photoUrl, // Добавляем URL фото
            lastUpdate: Date.now()
        };
        
        const playerRef = ref(firebaseDB, `players/${state.userId}`);
        await set(playerRef, playerData);
        console.log('✅ Данные синхронизированы с Firebase');
        
    } catch (error) {
        console.error('❌ Ошибка синхронизации:', error);
    }
}

// Функция для удаления данных игрока из Firebase
async function deletePlayerFromFirebase(userId) {
    if (!firebaseDB) {
        console.log('Firebase не инициализирован');
        return false;
    }
    
    try {
        const { ref, remove } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
        const playerRef = ref(firebaseDB, `players/${userId}`);
        await remove(playerRef);
        console.log('✅ Данные игрока удалены из Firebase');
        return true;
    } catch (error) {
        console.error('❌ Ошибка удаления:', error);
        return false;
    }
}

// Функция для удаления ВСЕХ игроков из Firebase
async function deleteAllPlayersFromFirebase() {
    if (!confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕХ игроков из базы данных!\n\nПродолжить?')) {
        return;
    }
    
    if (!confirm('Вы АБСОЛЮТНО уверены? Это удалит данные ВСЕХ пользователей!')) {
        return;
    }
    
    if (!firebaseDB) {
        showToast('❌ Firebase не инициализирован', 'error');
        return;
    }
    
    try {
        showToast('⏳ Загрузка списка игроков...', 'warning');
        
        // Сначала получаем список всех игроков
        const { ref, get, remove } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
        const playersRef = ref(firebaseDB, 'players');
        const snapshot = await get(playersRef);
        
        if (!snapshot.exists()) {
            showToast('✅ База данных уже пуста', 'success');
            return;
        }
        
        const players = snapshot.val();
        const playerIds = Object.keys(players);
        
        showToast(`⏳ Удаление ${playerIds.length} игроков...`, 'warning');
        
        // Удаляем каждого игрока по отдельности
        let deleted = 0;
        for (const userId of playerIds) {
            try {
                const playerRef = ref(firebaseDB, `players/${userId}`);
                await remove(playerRef);
                deleted++;
                
                // Показываем прогресс каждые 10 игроков
                if (deleted % 10 === 0) {
                    console.log(`Удалено ${deleted}/${playerIds.length} игроков`);
                }
            } catch (error) {
                console.error(`Ошибка удаления игрока ${userId}:`, error);
            }
        }
        
        showToast(`✅ Удалено ${deleted} игроков из Firebase!`, 'success');
        console.log(`✅ Удалено ${deleted} из ${playerIds.length} игроков`);
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (error) {
        console.error('❌ Ошибка удаления всех игроков:', error);
        showToast('❌ Ошибка при удалении данных', 'error');
    }
}

// Функция для полного сброса игры (локально + Firebase)
async function resetGameCompletely() {
    if (!confirm('⚠️ ВНИМАНИЕ! Это удалит ВСЕ ваши данные навсегда!\n\nПродолжить?')) {
        return;
    }
    
    if (!confirm('Вы уверены? Это действие НЕОБРАТИМО!')) {
        return;
    }
    
    try {
        // Удаляем из Firebase
        await deletePlayerFromFirebase(state.userId);
        
        // Очищаем localStorage
        localStorage.removeItem('bustClickerV4');
        localStorage.removeItem('shopLastUpdate');
        
        showToast('🗑️ Все данные удалены! Перезагрузите страницу.', 'success');
        
        // Перезагружаем страницу через 2 секунды
        setTimeout(() => {
            window.location.reload();
        }, 2000);
        
    } catch (error) {
        console.error('Ошибка сброса:', error);
        showToast('❌ Ошибка при сбросе данных', 'error');
    }
}

// Экспортируем функции в глобальную область для доступа из HTML
window.resetGameCompletely = resetGameCompletely;
window.deleteAllPlayersFromFirebase = deleteAllPlayersFromFirebase;

// Команда для очистки данных в консоли
window.clearMyData = async () => {
    console.log('🔄 Очистка ваших данных...');
    try {
        await deletePlayerFromFirebase(state.userId);
        localStorage.removeItem('bustClickerV4');
        localStorage.removeItem('shopLastUpdate');
        console.log('✅ Данные очищены! Перезагрузите страницу.');
        showToast('🗑️ Данные очищены! Перезагрузите страницу.', 'success');
    } catch (e) {
        console.error('❌ Ошибка:', e);
    }
};

// ============================================
// AUDIO ENGINE
// ============================================

let audioCtx;
function initAudio() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playSound(type) {
    if (!audioCtx) initAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;

    if (type === 'click') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(400, now + 0.1);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
    } else if (type === 'squish') {
        // Звук сжатия мягкой ткани - низкий "хлюпающий" звук
        osc.type = 'sine';
        
        // Первая фаза - сжатие (понижение частоты)
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(120, now + 0.08);
        osc.frequency.exponentialRampToValueAtTime(160, now + 0.15);
        
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.08, now + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.18);
        
        osc.start(now);
        osc.stop(now + 0.18);
        
        // Добавляем второй слой для "мягкости"
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(90, now);
        osc2.frequency.exponentialRampToValueAtTime(70, now + 0.1);
        osc2.frequency.exponentialRampToValueAtTime(85, now + 0.16);
        
        gain2.gain.setValueAtTime(0.06, now);
        gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.16);
        
        osc2.start(now + 0.02);
        osc2.stop(now + 0.18);
    } else if (type === 'buy') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.setValueAtTime(900, now + 0.1);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
    } else if (type === 'levelup') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.setValueAtTime(600, now + 0.1);
        osc.frequency.setValueAtTime(800, now + 0.2);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
    } else if (type === 'crit') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(1000, now);
        osc.frequency.exponentialRampToValueAtTime(1500, now + 0.05);
        osc.frequency.exponentialRampToValueAtTime(600, now + 0.15);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
    } else if (type === 'explosion') {
        // Взрыв - низкий грохот с шумом
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(80, now);
        osc.frequency.exponentialRampToValueAtTime(40, now + 0.3);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
        osc.start(now);
        osc.stop(now + 0.4);
        
        // Добавляем второй осциллятор для эффекта
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        osc2.type = 'square';
        osc2.frequency.setValueAtTime(120, now);
        osc2.frequency.exponentialRampToValueAtTime(30, now + 0.35);
        gain2.gain.setValueAtTime(0.12, now);
        gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
        osc2.start(now + 0.05);
        osc2.stop(now + 0.4);
    } else if (type === 'error') {
        // Звук ошибки
        osc.type = 'square';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.2);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
    }
}

// ============================================
// THREE.JS SETUP
// ============================================

let els = {};
let scene, camera, renderer, breastGroup, composer;
let targetScale = 1;
let currentScale = 1;
let pulseEffect = 0;
let autoclickInterval = null;
let upgradeAutoInterval = null;

function initThree() {
    const canvas = els.modelCanvas;
    const container = els.modelContainer;
    
    // Use a small delay to ensure container is rendered and has dimensions
    setTimeout(() => {
        const updateSize = () => {
            if (!container || !camera || !renderer) return;
            const rect = container.getBoundingClientRect();
            const width = rect.width || 350;
            const height = rect.height || 380;
            
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            renderer.setSize(width, height);
        };

        const rect = container.getBoundingClientRect();
        const width = rect.width || 350;
        const height = rect.height || 380;

        scene = new THREE.Scene();
        
        camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
        camera.position.set(0, 0.3, 4.5);
        camera.lookAt(0, 0, 0);
        
        renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        composer = null; 

        const ambient = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambient);

        const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
        keyLight.position.set(3, 4, 5);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.width = 1024;
        keyLight.shadow.mapSize.height = 1024;
        scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0xffb3d9, 0.4);
        fillLight.position.set(-4, 1, 3);
        scene.add(fillLight);

        const rimLight = new THREE.DirectionalLight(0xffd9e6, 0.3);
        rimLight.position.set(0, -3, -4);
        scene.add(rimLight);

        const topLight = new THREE.PointLight(0xffffff, 0.6, 10);
        topLight.position.set(0, 3, 2);
        scene.add(topLight);

        createBreasts();
        animate();

        // Handle resize with ResizeObserver for better responsiveness
        const resizeObserver = new ResizeObserver(() => {
            updateSize();
        });
        resizeObserver.observe(container);
        
        // Also listen to window resize as backup
        window.addEventListener('resize', updateSize);
        
        // Initial update
        updateSize();
    }, 100);
}

function createBreasts() {
    breastGroup = new THREE.Group();
    breastGroup.position.set(0, 0, 0); // Ensure centered

    const skinMat = new THREE.MeshStandardMaterial({
        color: 0xffdbd0,
        roughness: 0.4,
        metalness: 0.05,
    });

    // Улучшенная форма груди с более реалистичным профилем
    function createBreastGeometry() {
        const points = [];
        const segments = 32;
        
        for (let i = 0; i <= segments; i++) {
            const t = i / segments; // 0 (верх/сосок) to 1 (основание)
            let r;
            
            if (t < 0.02) {
                // Сосок - небольшая выпуклость
                r = 0.08 + t * 2;
            } else if (t < 0.15) {
                // Ареола - плавный переход
                const areolaT = (t - 0.02) / 0.13;
                r = 0.12 + Math.pow(areolaT, 0.6) * 0.35;
            } else if (t < 0.45) {
                // Верхняя часть - плавное увеличение
                const upperT = (t - 0.15) / 0.3;
                r = 0.47 + Math.sin(upperT * Math.PI * 0.5) * 0.35;
            } else if (t < 0.75) {
                // Самая полная часть - максимальный объём
                const midT = (t - 0.45) / 0.3;
                r = 0.82 + Math.sin(midT * Math.PI) * 0.08;
            } else {
                // Нижняя часть - плавное сужение к основанию
                const lowerT = (t - 0.75) / 0.25;
                r = 0.82 * (1 - Math.pow(lowerT, 1.2) * 0.75);
            }
            
            const y = t * 1.4;
            points.push(new THREE.Vector2(r, y));
        }
        
        // Закрываем у основания
        points.push(new THREE.Vector2(0, 1.4));
        
        return new THREE.LatheGeometry(points, 64);
    }

    const breastGeo = createBreastGeometry();

    const breastL = new THREE.Mesh(breastGeo, skinMat);
    breastL.rotation.x = -Math.PI / 2;
    breastL.position.set(-0.65, 0, 0);
    breastL.castShadow = true;
    breastL.receiveShadow = true;
    breastGroup.add(breastL);

    const breastR = new THREE.Mesh(breastGeo, skinMat);
    breastR.rotation.x = -Math.PI / 2;
    breastR.position.set(0.65, 0, 0);
    breastR.castShadow = true;
    breastR.receiveShadow = true;
    breastGroup.add(breastR);

    // ========================================
    // РЕАЛИСТИЧНЫЕ СОСКИ
    // ========================================
    
    // 1. Ареола - слегка выпуклый диск с текстурой
    const areolaMat = new THREE.MeshStandardMaterial({ 
        color: 0xd4787a,
        roughness: 0.65,
        metalness: 0.0,
    });
    
    // Ареола как приплюснутая сфера
    const areolaGeo = new THREE.SphereGeometry(0.24, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2.2);
    
    const areolaL = new THREE.Mesh(areolaGeo, areolaMat);
    areolaL.position.set(0, 0.015, 0);
    areolaL.scale.set(1, 0.18, 1);
    breastL.add(areolaL);

    const areolaR = new THREE.Mesh(areolaGeo, areolaMat);
    areolaR.position.set(0, 0.015, 0);
    areolaR.scale.set(1, 0.18, 1);
    breastR.add(areolaR);

    // 2. Сосок - реалистичная форма (цилиндр + полусфера)
    const nippleMat = new THREE.MeshStandardMaterial({ 
        color: 0xc96b6d,
        emissive: 0x2a0000,
        roughness: 0.3,
        metalness: 0.1,
    });
    
    // Основание соска (конус для плавного перехода)
    const nippleBaseGeo = new THREE.ConeGeometry(0.10, 0.15, 32);
    
    const nippleBaseL = new THREE.Mesh(nippleBaseGeo, nippleMat);
    nippleBaseL.position.set(0, 0.10, 0);
    breastL.add(nippleBaseL);
    
    const nippleBaseR = new THREE.Mesh(nippleBaseGeo, nippleMat);
    nippleBaseR.position.set(0, 0.10, 0);
    breastR.add(nippleBaseR);
    
    // Средняя часть соска (цилиндр)
    const nippleMidGeo = new THREE.CylinderGeometry(0.09, 0.10, 0.12, 32);
    
    const nippleMidL = new THREE.Mesh(nippleMidGeo, nippleMat);
    nippleMidL.position.set(0, 0.19, 0);
    breastL.add(nippleMidL);
    
    const nippleMidR = new THREE.Mesh(nippleMidGeo, nippleMat);
    nippleMidR.position.set(0, 0.19, 0);
    breastR.add(nippleMidR);
    
    // Верхушка соска (полусфера - закруглённый кончик)
    const nippleTipGeo = new THREE.SphereGeometry(0.09, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    
    const nippleTipL = new THREE.Mesh(nippleTipGeo, nippleMat);
    nippleTipL.position.set(0, 0.25, 0);
    breastL.add(nippleTipL);
    
    const nippleTipR = new THREE.Mesh(nippleTipGeo, nippleMat);
    nippleTipR.position.set(0, 0.25, 0);
    breastR.add(nippleTipR);

    scene.add(breastGroup);
    updateTargetScale();
}

function updateTargetScale() {
    const base = 0.8;
    const growth = Math.sqrt(state.size) * 0.1;
    targetScale = Math.min(base + growth, 2.5); 
}

function animate() {
    requestAnimationFrame(animate);

    const t = Date.now() * 0.001;

    currentScale += (targetScale - currentScale) * 0.1;
    
    const finalScale = currentScale * (1 + pulseEffect);
    pulseEffect *= 0.85; 

    const breath = Math.sin(t * 2) * 0.008;

    if (breastGroup) {
        breastGroup.children.forEach((breast, i) => {
            const scale = finalScale * (1 + breath);
            breast.scale.setScalar(scale);
            
            const separation = 0.6 + (scale - 0.8) * 0.1;
            breast.position.x = i === 0 ? -separation : separation;
        });

        breastGroup.rotation.y = Math.sin(t * 0.5) * 0.05;
    }

    if (composer) {
        composer.render();
    } else {
        renderer.render(scene, camera);
    }
}

// ============================================
// LOGIC
// ============================================

function saveState() {
    localStorage.setItem('bustClickerV4', JSON.stringify(state));
    if (!localStorage.getItem('shopLastUpdate')) {
        localStorage.setItem('shopLastUpdate', Date.now().toString());
    }
    
    // Синхронизация с сервером
    syncPlayerData();
}

function loadState() {
    const saved = localStorage.getItem('bustClickerV4');
    if (saved) {
        const parsed = JSON.parse(saved);
        state = { ...state, ...parsed };
        if (!state.upgrades) state.upgrades = {};
        state.activeEffects = state.activeEffects.filter(e => !e.endTime || e.endTime > Date.now());
    }
    
    // Инициализация таймера магазина
    if (!localStorage.getItem('shopLastUpdate')) {
        localStorage.setItem('shopLastUpdate', Date.now().toString());
    }
    
    // Инициализация ежедневной награды
    if (!state.dailyRewardLastClaim) state.dailyRewardLastClaim = 0;
    if (!state.dailyRewardStreak) state.dailyRewardStreak = 0;
}

function showToast(msg, type = 'success') {
    els.toast.textContent = msg;
    els.toast.className = 'toast ' + type + ' show';
    setTimeout(() => els.toast.classList.remove('show'), 2500);
}

function formatTime(ms) {
    if (ms <= 0) return '0с';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    if (h > 0) return `${h}ч ${m}м`;
    if (m > 0) return `${m}м ${s}с`;
    return `${s}с`;
}

function formatTimeShort(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function weightedRandom(items) {
    const total = items.reduce((s, i) => s + i.weight, 0);
    let r = Math.random() * total;
    for (const item of items) {
        r -= item.weight;
        if (r <= 0) return item;
    }
    return items[0];
}

function getLevel() {
    const effects = getAllUpgradeEffects();
    const reduction = effects.levelReduction || 0;
    const sizePerLvl = Math.max(10, SIZE_PER_LEVEL - reduction);
    return Math.floor(state.size / sizePerLvl);
}

function getLevelProgress() {
    const effects = getAllUpgradeEffects();
    const reduction = effects.levelReduction || 0;
    const sizePerLvl = Math.max(10, SIZE_PER_LEVEL - reduction);
    const currentLevelSize = getLevel() * sizePerLvl;
    const progress = state.size - currentLevelSize;
    return (progress / sizePerLvl) * 100;
}

function calcPerClick() {
    const effects = getAllUpgradeEffects();
    const now = Date.now();

    // База: 1 + бонус от апгрейда "Сила клика"
    let base = 1 + (effects.clickBonus || 0);

    // Множитель от апгрейда "Мультипликатор"
    base *= (effects.clickMulti || 1);

    // Множитель от апгрейда "Престижная мощь"
    base *= (effects.prestigeMulti || 1);

    // Глобальный множитель от апгрейда "Алмазное касание"
    base *= (effects.globalMulti || 1);

    // Активные эффекты из магазина/кейсов (x2, x5, x10, x20)
    // Используем только самый сильный множитель
    let maxMultiplier = 1;
    state.activeEffects.forEach(e => {
        if (e.endTime > now && e.effect.type === 'multiply') {
            maxMultiplier = Math.max(maxMultiplier, e.effect.value);
        }
    });
    base *= maxMultiplier;

    return Math.max(1, Math.floor(base));
}

function isFrozen() {
    return state.activeEffects.some(e => e.effect.type === 'freeze' && e.endTime > Date.now());
}

function handleClick(e) {
    // Check if blocked by anti-cheat
    if (antiCheat && antiCheat.isBlocked) {
        showToast('🚫 Подозрительная активность обнаружена. Подождите...', 'error');
        return;
    }
    
    if (isFrozen()) {
        showToast('Заморожено! ❄️', 'error');
        return;
    }
    
    const effects = getAllUpgradeEffects();
    let amount = calcPerClick();
    let isCrit = false;
    let isLucky = false;

    // Critical hit check (база + critBoost)
    const critChance = (effects.critChance || 0) + (effects.critBoost || 0);
    if (Math.random() < critChance) {
        amount *= 5;
        isCrit = true;
    }

    // Lucky star check
    if (!isCrit && Math.random() < (effects.luckyChance || 0)) {
        amount *= 10;
        isLucky = true;
    }
    
    const oldLevel = getLevel();
    
    state.size += amount;
    state.totalClicks++;
    
    // Coin magnet check
    if (Math.random() < (effects.coinChance || 0)) {
        const coinGain = effects.coinAmount || 1;
        state.coins += coinGain;
    }

    const newLevel = getLevel();
    if (newLevel > oldLevel) {
        showToast(`⬆️ Уровень ${newLevel}! Бонус +${(getLevelBonus() * 100).toFixed(1)}%`, 'success');
        playSound('levelup');
    } else if (isCrit) {
        playSound('crit');
    } else if (isLucky) {
        playSound('crit');
    } else {
        // Используем звук сжатия для обычных кликов
        playSound('squish');
    }

    pulseEffect = isCrit || isLucky ? 0.4 : 0.2; 
    updateTargetScale(); 
    
    checkAchievements();
    updateUI();
    saveState();
    
    createFloatingNum(amount, e, isCrit, isLucky);
    createParticles(e);
    if (isCrit || isLucky) {
        createParticles(e);
        createParticles(e);
    }
    createHeart(e);
}

function createFloatingNum(amount, e, isCrit = false, isLucky = false) {
    const num = document.createElement('div');
    num.className = 'float-num';
    
    // Формируем красивый текст
    let content = `<span>+${amount}</span>`;
    if (isCrit) content = `<span style="font-size: 1.2em">💥</span> <span>+${amount}</span>`;
    if (isLucky) content = `<span style="font-size: 1.2em">⭐</span> <span>+${amount}</span>`;
    
    num.innerHTML = content;
    
    // Специальные стили для особых кликов
    if (isCrit) {
        num.style.color = '#fbbf24'; // Gold
        num.style.fontSize = '36px';
        num.style.zIndex = '1001';
        num.style.textShadow = '0 0 20px rgba(251, 191, 36, 0.8)';
    } else if (isLucky) {
        num.style.color = '#00ffff'; // Cyan
        num.style.fontSize = '36px';
        num.style.zIndex = '1002';
        num.style.textShadow = '0 0 20px rgba(0, 255, 255, 0.8)';
    } else {
        // Обычный клик - случайный пастельный цвет для разнообразия
        const colors = ['#fff', '#fce7f3', '#e0e7ff', '#d1fae5'];
        num.style.color = colors[Math.floor(Math.random() * colors.length)];
    }
    
    const rect = els.modelContainer.getBoundingClientRect();
    // Use click coordinates if available, otherwise center
    const x = e && e.clientX ? e.clientX : rect.left + rect.width / 2;
    const y = e && e.clientY ? e.clientY : rect.top + rect.height * 0.4;
    
    // Random position offset
    const randomX = (Math.random() - 0.5) * 60;
    
    num.style.left = `${x + randomX}px`;
    num.style.top = `${y - 40}px`;
    
    document.body.appendChild(num);
    setTimeout(() => num.remove(), 800);
}

function createParticles(e) {
    const rect = els.modelContainer.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const colors = ['#ff4d8d', '#b366ff', '#fbbf24', '#4ade80'];
    
    for (let i = 0; i < 8; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        p.style.background = colors[Math.floor(Math.random() * colors.length)];
        p.style.left = x + 'px';
        p.style.top = y + 'px';
        p.style.setProperty('--tx', (Math.random() - 0.5) * 120 + 'px');
        p.style.setProperty('--ty', (Math.random() - 0.5) * 120 + 'px');
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 600);
    }
}

function createHeart(e) {
    const rect = els.modelContainer.getBoundingClientRect();
    const h = document.createElement('div');
    h.className = 'heart-particle';
    h.innerHTML = '❤';
    h.style.left = rect.left + rect.width / 2 + (Math.random() - 0.5) * 60 + 'px';
    h.style.top = rect.top + rect.height * 0.4 + 'px';
    document.body.appendChild(h);
    setTimeout(() => h.remove(), 1000);
}

function exchangeSize() {
    const amount = parseInt(els.exchangeAmount.value) || 0;
    if (amount <= 0) return showToast('Введите сумму', 'error');
    if (amount > state.size) return showToast('Недостаточно размера', 'error');
    
    state.size -= amount;
    
    const effects = getAllUpgradeEffects();
    const hasGoldenTouch = state.inventory.some(i => i.id === 'golden_touch');
    let rate = EXCHANGE_RATE + (effects.exchangeBonus || 0);
    if (hasGoldenTouch) rate *= 3;
    
    state.coins += Math.floor(amount * rate);
    state.statsExchanges += amount;
    
    updateTargetScale();
    updateUI();
    checkAchievements();
    saveState();
    showToast(`+${Math.floor(amount * rate).toLocaleString()} монет!`, 'success');
}

// ============================================
// UI & RENDERING
// ============================================

function updateUI() {
    els.coinCount.textContent = state.coins.toLocaleString();
    els.sizeCount.textContent = state.size.toLocaleString();
    els.starCount.textContent = state.stars.toLocaleString();
    els.modelSize.textContent = state.size.toLocaleString();
    els.perClickVal.textContent = '+' + calcPerClick();

    const effects = getAllUpgradeEffects();
    const rate = EXCHANGE_RATE + (effects.exchangeBonus || 0);
    els.exchangeRate.textContent = `Курс: 1 ед. размера = ${rate} монет`;

    const level = getLevel();
    const progress = getLevelProgress();
    const tier = getProgressTier();
    const priceMulti = getPriceMultiplier();

    // Показываем множитель цен если он больше 1
    if (priceMulti > 1) {
        els.userRank.textContent = `Ранг: Tier ${tier} (x${priceMulti.toFixed(1)} цены)`;
    } else {
        const allPlayers = [...LEADERBOARD_DATA];
        allPlayers.push({
            name: state.userName,
            size: state.size,
            coins: state.coins,
            time: state.totalPlayTime,
            achievements: state.unlockedAchievements,
            isCurrentUser: true
        });
        allPlayers.sort((a, b) => b[els.currentLbType] - a[els.currentLbType]);
        const userRank = allPlayers.findIndex(p => p.isCurrentUser) + 1;
        els.userRank.textContent = `Ранг: #${userRank}`;
    }

    renderInventory();
    renderActiveEffectsBar();
}

function checkAchievements() {
    ACHIEVEMENTS.forEach(ach => {
        if (!state.unlockedAchievements.includes(ach.id) && ach.condition(state)) {
            state.unlockedAchievements.push(ach.id);
            showToast(`🏆 Достижение: ${ach.name}!`, 'success');
        }
    });
    updateAchievementsUI();
}

function updateAchievementsUI() {
    els.achGrid.innerHTML = '';
    els.achProgress.textContent = `${state.unlockedAchievements.length}/${ACHIEVEMENTS.length}`;
    
    ACHIEVEMENTS.forEach(ach => {
        const unlocked = state.unlockedAchievements.includes(ach.id);
        const div = document.createElement('div');
        div.className = `ach-item ${unlocked ? 'unlocked' : ''}`;
        div.innerHTML = `<div class="ach-icon">${ach.icon}</div><div class="ach-name">${ach.name}</div>`;
        div.onclick = () => showAchievementInfo(ach, div);
        els.achGrid.appendChild(div);
    });
}

function showAchievementInfo(ach, element) {
    document.querySelectorAll('.ach-item').forEach(el => el.classList.remove('selected'));
    element.classList.add('selected');

    const box = els.achInfoBox;
    box.classList.remove('empty');
    
    const unlocked = state.unlockedAchievements.includes(ach.id);
    
    box.innerHTML = `
        <div class="ach-info-title" style="color: ${unlocked ? 'var(--warning)' : 'var(--text-primary)'}">
            ${unlocked ? '✅ ' + ach.name + ' (Получено)' : '🔒 ' + ach.name}
        </div>
        <div class="ach-info-desc">${ach.desc}</div>
    `;
}

function renderShop() {
    els.shopGrid.innerHTML = '';
    SHOP_DB.forEach(item => {
        const scaledPrice = getScaledPrice(item.price);
        const div = document.createElement('div');
        div.className = 'shop-item';
        div.innerHTML = `
            <div class="shop-item-icon" style="background: ${item.color}; color: #0d0d12;">${item.icon}</div>
            <div class="shop-item-info">
                <div class="shop-item-name">${item.name}</div>
                <div class="shop-item-desc">${item.desc}</div>
            </div>
            <div class="shop-item-price">$ ${scaledPrice.toLocaleString()}</div>
        `;
        div.addEventListener('click', () => buyItem(item, scaledPrice));
        els.shopGrid.appendChild(div);
    });
}

function buyItem(item, price) {
    if (state.coins < price) return showToast('Недостаточно монет!', 'error');
    
    // Проверяем, есть ли уже активный буст того же типа
    if (item.effect && item.effect.type === 'multiply') {
        const existingBoost = state.activeEffects.find(e => 
            e.effect.type === 'multiply' && e.endTime > Date.now()
        );
        if (existingBoost) {
            showToast(`⚠️ Уже активен буст x${existingBoost.effect.value}! Будет использован сильнейший.`, 'warning');
        }
    }
    
    state.coins -= price;
    playSound('buy');

    if (item.type === 'instant') {
        if (item.effect.type === 'instantSize') {
            state.size += item.effect.value;
            updateTargetScale();
            showToast(`+${item.effect.value} к размеру!`, 'success');
        } else if (item.effect.type === 'instantTime') {
            state.totalPlayTime += item.effect.value;
            showToast(`+${formatTime(item.effect.value)}!`, 'success');
        }
    } else if (item.type === 'passive') {
        state.inventory.push({ ...item, obtainedAt: Date.now() });
        showToast(`${item.name} активировано!`, 'success');
    } else {
        state.inventory.push({ ...item, obtainedAt: Date.now() });
        showToast(`${item.name} в инвентаре!`, 'success');
    }
    updateUI();
    saveState();
}

function renderCases() {
    els.casesGrid.innerHTML = '';
    CASES.forEach(c => {
        const div = document.createElement('div');
        div.className = `case-card ${c.rarity}`;
        div.innerHTML = `
            <div class="case-icon ${RARITY[c.rarity].cls}">${c.icon}</div>
            <div class="case-name">${c.name}</div>
            <div class="case-desc">${c.desc}</div>
            <div class="case-price">⭐ ${c.price} звёзд</div>
        `;
        div.addEventListener('click', () => openCase(c));
        els.casesGrid.appendChild(div);
    });
}

function openCase(c) {
    if (state.stars < c.price) return showToast('Недостаточно звёзд!', 'error');
    state.stars -= c.price;
    state.statsCases++;
    playSound('buy');
    updateUI();
    saveState();

    // Анимация открытия кейса
    showCaseOpeningAnimation(c, () => {
        // Шанс на Legendary зависит от цены кейса
        // 1 звезда = 2% на legendary, 2 звезды = 10%, 3 звезды = 25%
        let legendaryChance = 0;
        if (c.price === 1) legendaryChance = 0.02;
        else if (c.price === 2) legendaryChance = 0.10;
        else if (c.price === 3) legendaryChance = 0.25;

        const roll = Math.random();
        let availableRewards;

        if (roll < legendaryChance) {
            // Выпал шанс на Legendary!
            availableRewards = CASE_REWARDS.filter(r => r.rarity === 'legendary');
        } else {
            // Обычные награды по редкости кейса
            if (c.rarity === 'common') {
                availableRewards = CASE_REWARDS.filter(r => ['common', 'rare'].includes(r.rarity));
            } else if (c.rarity === 'rare') {
                availableRewards = CASE_REWARDS.filter(r => ['common', 'rare', 'epic'].includes(r.rarity));
            } else if (c.rarity === 'epic') {
                availableRewards = CASE_REWARDS.filter(r => ['rare', 'epic', 'legendary'].includes(r.rarity));
            } else {
                availableRewards = CASE_REWARDS;
            }
        }

        const reward = weightedRandom(availableRewards);
        showRewardModal(reward, c);
    });
}

function showCaseOpeningAnimation(caseData, onComplete) {
    const modal = document.createElement('div');
    modal.className = 'case-opening-modal';
    modal.innerHTML = `
        <div class="case-opening-content">
            <div class="case-opening-icon">${caseData.icon}</div>
            <div class="case-opening-title">Открываем...</div>
            <div class="case-opening-progress">
                <div class="case-opening-bar"></div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Анимация тряски
    const icon = modal.querySelector('.case-opening-icon');
    let shakeIntensity = 0;
    const shakeInterval = setInterval(() => {
        shakeIntensity += 0.1;
        const shake = Math.sin(shakeIntensity) * (5 + shakeIntensity * 0.5);
        icon.style.transform = `translate(${shake}px, ${Math.cos(shakeIntensity) * 3}px) rotate(${shake}deg)`;
    }, 16);
    
    // Прогресс бар
    const bar = modal.querySelector('.case-opening-bar');
    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += 2;
        bar.style.width = progress + '%';
        if (progress >= 100) {
            clearInterval(progressInterval);
            clearInterval(shakeInterval);
        }
    }, 30);
    
    setTimeout(() => {
        modal.remove();
        onComplete();
    }, 1500);
}

function showRewardModal(reward, caseData = null) {
    els.modalIcon.style.display = 'flex';
    els.modalIcon.className = 'modal-icon';
    els.modalIcon.classList.add(RARITY[reward.rarity].cls);
    els.modalIcon.textContent = reward.icon;

    els.modalTitle.textContent = reward.name;
    els.modalTitle.style.color = RARITY[reward.rarity].border;

    const rarityNames = { common: 'Обычный', rare: 'Редкий', epic: 'Эпический', legendary: 'Легендарный' };
    els.modalDesc.textContent = rarityNames[reward.rarity] + (reward.type === 'debuff' ? ' (Дебафф!)' : '');
    els.modalDesc.style.color = reward.type === 'debuff' ? '#f87171' : 'var(--text-secondary)';

    els.modalProfileStats.innerHTML = '';
    els.modalAchGrid.innerHTML = '';
    els.achInfoDisplay.style.display = 'none';

    els.modalBtn.textContent = 'Забрать';
    els.modalBtn.onclick = () => claimReward(reward, caseData);

    els.modalOverlay.classList.add('active');
}

function claimReward(reward, caseData = null) {
    closeModal();
    
    if (reward.type === 'debuff') {
        const shieldIdx = state.inventory.findIndex(i => i.effect.type === 'shield');
        if (shieldIdx !== -1) {
            state.inventory.splice(shieldIdx, 1);
            showToast('🛡️ Щит заблокировал дебафф!', 'success');
            updateUI(); saveState();
            return;
        }
    }

    // Пусто - ничего не получаем
    if (reward.type === 'empty') {
        showToast('💨 Пусто! Ничего не получено.', 'error');
        updateUI();
        saveState();
        return;
    }

    if (reward.type === 'instant') {
        if (reward.effect.type === 'instantSize') {
            state.size += reward.effect.value;
            updateTargetScale();
            showToast(`➕ +${reward.effect.value} размера!`, 'success');
        } else if (reward.effect.type === 'instantCoins') {
            state.coins += reward.effect.value;
            showToast(`💰 +${reward.effect.value} монет!`, 'success');
        } else if (reward.effect.type === 'jackpot') {
            const sizeBonus = Math.floor(state.size * reward.effect.value);
            const coinBonus = Math.floor(state.coins * reward.effect.value);
            state.size += sizeBonus;
            state.coins += coinBonus;
            updateTargetScale();
            showToast(`👑 ДЖЕКПОТ! +${sizeBonus.toLocaleString()} размера, +${coinBonus.toLocaleString()} монет!`, 'success');
        }
    } else if (reward.type === 'debuff') {
        if (reward.effect.type === 'percentLoss') {
            const loss = Math.floor(state.size * reward.effect.value);
            state.size = Math.max(0, state.size - loss);
            updateTargetScale();
            showToast(`💀 Потеряно ${loss} размера!`, 'error');
        } else if (reward.duration) {
            state.activeEffects.push({ ...reward, endTime: Date.now() + reward.duration });
        }
    } else if (reward.type === 'boost' && reward.duration) {
        // Все бусты отправляем в инвентарь, не активируем сразу
        state.inventory.push({ ...reward, obtainedAt: Date.now() });
        showToast(`🎒 ${reward.name} добавлен в инвентарь!`, 'success');
        
        // Визуальное подтверждение
        const btn = document.querySelector('.nav-item[data-tab="inventoryTab"]');
        if (btn) {
            btn.classList.add('pulse');
            setTimeout(() => btn.classList.remove('pulse'), 1500);
        }
    } else {
        state.inventory.push({ ...reward, obtainedAt: Date.now() });
        showToast(`🎒 ${reward.name} добавлен в инвентарь!`, 'success');

        // Визуальное подтверждение
        const btn = document.querySelector('.nav-item[data-tab="inventoryTab"]');
        if (btn) {
            btn.classList.add('pulse');
            setTimeout(() => btn.classList.remove('pulse'), 1500);
        }
    }

    updateUI();
    checkAchievements();
    saveState();
}

async function renderLeaderboard() {
    console.log('🔄 Рендер топа игроков...');
    
    // Показываем индикатор загрузки
    els.leaderboardList.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-secondary);"><div style="font-size: 32px; margin-bottom: 10px;">⏳</div>Загрузка топа игроков...</div>';
    
    // Получаем данные других игроков из Firebase
    const otherPlayers = await fetchLeaderboard();
    
    // ДЕБАГ: Показываем сколько игроков загружено
    const debugInfo = `Загружено из Firebase: ${otherPlayers.length} игроков`;
    console.log(`📊 ${debugInfo}`);
    
    // Создаём список всех игроков
    const allPlayers = [];
    
    // Добавляем игроков из Firebase
    otherPlayers.forEach(player => {
        // Если это текущий игрок - обновляем его данными из state
        if (player.userId === state.userId) {
            allPlayers.push({
                userId: state.userId,
                name: state.userName,
                size: state.size,
                coins: state.coins,
                time: state.totalPlayTime,
                achievements: state.unlockedAchievements,
                photoUrl: player.photoUrl || null, // Берём фото из Firebase
                isCurrentUser: true
            });
        } else {
            allPlayers.push({
                ...player,
                isCurrentUser: false
            });
        }
    });
    
    // Если текущего игрока нет в списке - добавляем
    if (!allPlayers.some(p => p.userId === state.userId)) {
        // Получаем фото из Telegram
        const tg = window.Telegram?.WebApp;
        let photoUrl = null;
        if (tg && tg.initDataUnsafe?.user?.photo_url) {
            photoUrl = tg.initDataUnsafe.user.photo_url;
        }
        
        allPlayers.push({
            userId: state.userId,
            name: state.userName,
            size: state.size,
            coins: state.coins,
            time: state.totalPlayTime,
            achievements: state.unlockedAchievements,
            photoUrl: photoUrl,
            isCurrentUser: true
        });
    }
    
    // Сортируем по размеру
    allPlayers.sort((a, b) => b.size - a.size);
    
    console.log(`✅ Всего игроков в топе: ${allPlayers.length}`);
    
    // Находим позицию текущего игрока
    const userRank = allPlayers.findIndex(p => p.isCurrentUser) + 1;
    
    // Обновляем ранг в хедере
    const tier = getProgressTier();
    const priceMulti = getPriceMultiplier();
    if (priceMulti > 1) {
        els.userRank.textContent = `Ранг: #${userRank} | Tier ${tier} (x${priceMulti.toFixed(1)})`;
    } else {
        els.userRank.textContent = `Ранг: #${userRank}`;
    }
    
    els.leaderboardList.innerHTML = '';
    
    // ДЕБАГ: Добавляем информацию о загрузке
    if (otherPlayers.length === 0) {
        const debugDiv = document.createElement('div');
        debugDiv.style.cssText = 'background: #ff4d4d; color: white; padding: 10px; margin: 10px; border-radius: 8px; font-size: 11px;';
        debugDiv.innerHTML = `
            <strong>⚠️ ДЕБАГ:</strong><br>
            Firebase вернул 0 игроков!<br>
            Проверь правила Firebase:<br>
            <code style="background: rgba(0,0,0,0.3); padding: 2px 4px; border-radius: 3px;">
            {<br>
            &nbsp;&nbsp;"rules": {<br>
            &nbsp;&nbsp;&nbsp;&nbsp;"players": {<br>
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"$userId": {<br>
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;".read": true,<br>
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;".write": true<br>
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}<br>
            &nbsp;&nbsp;&nbsp;&nbsp;}<br>
            &nbsp;&nbsp;}<br>
            }
            </code>
        `;
        els.leaderboardList.appendChild(debugDiv);
    }
    
    // Показываем топ-100
    const topPlayers = allPlayers.slice(0, 100);
    
    topPlayers.forEach((player, idx) => {
        const div = document.createElement('div');
        div.className = `leaderboard-item ${player.isCurrentUser ? 'current-user' : ''}`;
        
        let rankClass = '';
        if (idx === 0) rankClass = 'gold';
        else if (idx === 1) rankClass = 'silver';
        else if (idx === 2) rankClass = 'bronze';
        
        // Аватарка: если есть фото - показываем, иначе первую букву имени
        const avatarContent = player.photoUrl 
            ? `<img src="${player.photoUrl}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;" onerror="this.style.display='none'; this.parentElement.textContent='${player.name.charAt(0)}'">` 
            : player.name.charAt(0);
        
        div.innerHTML = `
            <div class="lb-rank ${rankClass}">${idx + 1}</div>
            <div class="lb-avatar">${avatarContent}</div>
            <div class="lb-info">
                <div class="lb-name ${player.isCurrentUser ? 'you' : ''}">${player.name}${player.isCurrentUser ? ' (Ты)' : ''}</div>
            </div>
            <div class="lb-value">${player.size.toLocaleString()}<span>${(player.achievements || []).length} ачивок</span></div>
        `;
        
        div.addEventListener('click', () => {
            window.haptic('light');
            showProfile(player);
        });
        els.leaderboardList.appendChild(div);
    });
    
    // Если игроков нет (только ты), показываем подсказку
    if (allPlayers.length === 1) {
        const hint = document.createElement('div');
        hint.style.cssText = 'text-align: center; padding: 20px; color: var(--text-muted); font-size: 12px;';
        hint.innerHTML = `👥 Пока ты один в топе!<br>Скоро появятся другие игроки.<br><br><small style="color: var(--text-muted);">(Firebase: ${otherPlayers.length} игроков)</small>`;
        els.leaderboardList.appendChild(hint);
    }
}

function showProfile(player) {
    els.modalIcon.style.display = 'none';
    els.modalTitle.textContent = player.name;
    els.modalDesc.textContent = player.isCurrentUser ? 'Ваш профиль' : 'Профиль игрока';
    
    els.modalProfileStats.innerHTML = `
        <div class="profile-stats">
            <div class="profile-stat size">
                <div class="profile-stat-icon">📏</div>
                <div class="profile-stat-val">${player.size.toLocaleString()}</div>
                <div class="profile-stat-label">Размер</div>
            </div>
            <div class="profile-stat coins">
                <div class="profile-stat-icon">💰</div>
                <div class="profile-stat-val">${player.coins.toLocaleString()}</div>
                <div class="profile-stat-label">Монеты</div>
            </div>
            <div class="profile-stat time">
                <div class="profile-stat-icon">⏱️</div>
                <div class="profile-stat-val">${formatTime(player.time)}</div>
                <div class="profile-stat-label">В игре</div>
            </div>
        </div>
    `;
    
    els.achInfoDisplay.style.display = 'none';
    els.modalAchGrid.innerHTML = '';
    
    ACHIEVEMENTS.forEach(ach => {
        const unlocked = player.achievements.includes(ach.id);
        const div = document.createElement('div');
        div.className = `ach-item mini ${unlocked ? 'unlocked' : ''}`;
        div.innerHTML = `<div class="ach-icon">${ach.icon}</div>`;
        
        div.onclick = () => {
            els.achInfoDisplay.style.display = 'block';
            els.achInfoTitle.textContent = ach.name;
            els.achInfoDesc.textContent = ach.desc;
            els.achInfoTitle.style.color = unlocked ? 'var(--gold)' : 'var(--text-secondary)';
        };
        
        els.modalAchGrid.appendChild(div);
    });
    
    els.modalBtn.textContent = 'Закрыть';
    els.modalBtn.onclick = closeModal;
    
    els.modalOverlay.classList.add('active');
}

function renderInventory() {
    const now = Date.now();
    const active = state.activeEffects.filter(e => e.endTime > now);
    
    els.activeItems.innerHTML = '';
    els.noActive.style.display = active.length ? 'none' : 'block';
    active.forEach(eff => {
        const left = Math.max(0, eff.endTime - now);
        const div = document.createElement('div');
        div.className = `inventory-item active ${eff.type === 'debuff' ? 'debuff' : ''}`;
        div.innerHTML = `<div class="inv-icon">${eff.icon}</div><div class="inv-name">${eff.name}</div><div class="inv-timer active">${formatTime(left)}</div>`;
        els.activeItems.appendChild(div);
    });
    
    const usable = state.inventory.filter(i => i.type !== 'instant');
    els.inventoryGrid.innerHTML = '';
    els.noInventory.style.display = usable.length ? 'none' : 'block';
    usable.forEach((item, idx) => {
        const div = document.createElement('div');
        div.className = 'inventory-item';
        div.innerHTML = `<div class="inv-icon">${item.icon}</div><div class="inv-name">${item.name}</div><button class="use-btn">Использовать</button>`;
        div.querySelector('.use-btn').onclick = () => useItem(item);
        els.inventoryGrid.appendChild(div);
    });
}

function useItem(item) {
    if (item.type === 'shield' || item.type === 'passive') return;
    
    // Проверяем, есть ли уже активный буст того же типа
    if (item.effect.type === 'multiply') {
        const existingBoost = state.activeEffects.find(e => 
            e.effect.type === 'multiply' && e.endTime > Date.now()
        );
        if (existingBoost) {
            showToast(`⚠️ Уже активен буст x${existingBoost.effect.value}! Будет использован сильнейший.`, 'warning');
        }
    }
    
    state.activeEffects.push({ ...item, endTime: Date.now() + item.duration });
    state.inventory = state.inventory.filter(i => i !== item);
    state.statsBuffsUsed++;
    showToast(`${item.name} активирован!`, 'success');
    processEffects();
    checkAchievements();
    saveState();
    updateUI();
}

function processEffects() {
    const now = Date.now();
    state.activeEffects = state.activeEffects.filter(e => !e.endTime || e.endTime > now);
    
    const hasAuto = state.activeEffects.some(e => e.effect.type === 'autoclick' && e.endTime > now);
    
    if (hasAuto && !autoclickInterval) {
        let clickPower = 1;
        state.activeEffects.forEach(e => {
            if (e.endTime > Date.now() && e.effect.type === 'autoclick') {
                clickPower = Math.max(clickPower, e.effect.value);
            }
        });

        autoclickInterval = setInterval(() => {
            if (!isFrozen()) {
                state.size += calcPerClick() * clickPower;
                state.totalClicks += clickPower;
                pulseEffect = 0.03;
                updateTargetScale();
                updateUI();
                saveState();
            }
        }, 1000);
    } else if (!hasAuto && autoclickInterval) {
        clearInterval(autoclickInterval);
        autoclickInterval = null;
    }
}

// Upgrade-based auto clicker
function processUpgradeAuto() {
    const effects = getAllUpgradeEffects();
    const autoPerSec = effects.autoPerSec || 0;
    
    if (autoPerSec > 0 && !isFrozen()) {
        state.size += autoPerSec;
        updateTargetScale();
        updateUI();
        saveState();
    }
}

function renderActiveEffectsBar() {
    const now = Date.now();
    const effects = getAllUpgradeEffects();
    els.activeEffectsBar.innerHTML = '';
    
    // Show upgrade auto-click if active
    if (effects.autoPerSec > 0) {
        const pill = document.createElement('div');
        pill.className = 'effect-pill buff';
        pill.textContent = `🤖 +${effects.autoPerSec}/с`;
        els.activeEffectsBar.appendChild(pill);
    }
    
    state.activeEffects.filter(e => e.endTime > now).forEach(eff => {
        const pill = document.createElement('div');
        pill.className = `effect-pill ${eff.type === 'debuff' ? 'debuff' : 'buff'}`;
        pill.textContent = `${eff.icon} ${eff.name} ${formatTime(Math.max(0, eff.endTime - now))}`;
        els.activeEffectsBar.appendChild(pill);
    });
}

function closeModal() {
    els.modalOverlay.classList.remove('active');
}

// ============================================
// DAILY REWARD GAME
// ============================================

let dailyGameState = {
    grid: [],
    keysFound: 0,
    gameOver: false,
    reward: null,
    attempts: 3,
    maxAttempts: 3
};

function createExplosion(x, y) {
    // Основной эффект взрыва
    const explosion = document.createElement('div');
    explosion.className = 'explosion-effect';
    explosion.innerHTML = '💥';
    explosion.style.fontSize = '80px';
    explosion.style.left = x + 'px';
    explosion.style.top = y + 'px';
    explosion.style.transform = 'translate(-50%, -50%)';
    document.body.appendChild(explosion);
    
    setTimeout(() => explosion.remove(), 600);
    
    // Частицы взрыва
    const colors = ['#ff4d4d', '#ff8800', '#ffaa00', '#ff6b6b', '#ff0000'];
    for (let i = 0; i < 20; i++) {
        const particle = document.createElement('div');
        particle.className = 'explosion-particle';
        particle.style.background = colors[Math.floor(Math.random() * colors.length)];
        particle.style.left = x + 'px';
        particle.style.top = y + 'px';
        
        const angle = (Math.PI * 2 * i) / 20;
        const distance = 80 + Math.random() * 40;
        const ex = Math.cos(angle) * distance;
        const ey = Math.sin(angle) * distance;
        
        particle.style.setProperty('--ex', ex + 'px');
        particle.style.setProperty('--ey', ey + 'px');
        
        document.body.appendChild(particle);
        setTimeout(() => particle.remove(), 800);
    }
    
    // Дополнительные искры
    for (let i = 0; i < 10; i++) {
        setTimeout(() => {
            const spark = document.createElement('div');
            spark.className = 'explosion-particle';
            spark.style.background = '#ffff00';
            spark.style.width = '4px';
            spark.style.height = '4px';
            spark.style.left = x + 'px';
            spark.style.top = y + 'px';
            
            const angle = Math.random() * Math.PI * 2;
            const distance = 60 + Math.random() * 60;
            const ex = Math.cos(angle) * distance;
            const ey = Math.sin(angle) * distance;
            
            spark.style.setProperty('--ex', ex + 'px');
            spark.style.setProperty('--ey', ey + 'px');
            
            document.body.appendChild(spark);
            setTimeout(() => spark.remove(), 600);
        }, i * 30);
    }
}

function shakeScreen() {
    document.body.classList.add('screen-shake');
    setTimeout(() => {
        document.body.classList.remove('screen-shake');
    }, 500);
}

function canClaimDaily() {
    const now = Date.now();
    return (now - state.dailyRewardLastClaim) >= DAILY_REWARD_COOLDOWN;
}

function getTimeUntilNextDaily() {
    const now = Date.now();
    const nextClaim = state.dailyRewardLastClaim + DAILY_REWARD_COOLDOWN;
    return Math.max(0, nextClaim - now);
}

function initDailyGame() {
    // Создаём сетку 3x3 (9 ячеек)
    // 1 ключ, 8 мин
    const cells = ['key', 'bomb', 'bomb', 'bomb', 'bomb', 'bomb', 'bomb', 'bomb', 'bomb'];
    
    // Перемешиваем
    for (let i = cells.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    
    // Выбираем награду с учётом весов (редкости)
    dailyGameState = {
        grid: cells.map(type => ({ type, revealed: false })),
        keysFound: 0,
        gameOver: false,
        reward: weightedRandom(DAILY_REWARDS),
        attempts: 3,
        maxAttempts: 3
    };
}

function revealCell(index) {
    if (dailyGameState.gameOver) return;
    if (dailyGameState.grid[index].revealed) return;
    
    window.haptic('medium');
    dailyGameState.grid[index].revealed = true;
    
    const cell = dailyGameState.grid[index];
    
    if (cell.type === 'bomb') {
        // Попали на мину - минус попытка!
        dailyGameState.attempts--;
        
        // Получаем координаты ячейки для взрыва
        const cellElements = document.querySelectorAll('.daily-cell');
        const cellElement = cellElements[index];
        const rect = cellElement.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        
        // Сначала показываем мину
        renderDailyReward();
        
        // Через короткую задержку - взрыв!
        setTimeout(() => {
            playSound('explosion');
            window.haptic('heavy');
            createExplosion(x, y);
            shakeScreen();
            
            if (dailyGameState.attempts <= 0) {
                // Попытки закончились - проигрыш
                dailyGameState.gameOver = true;
                setTimeout(() => {
                    dailyGameState.grid.forEach(c => c.revealed = true);
                    renderDailyReward();
                    showToast('💣 Попытки закончились! Попробуй завтра!', 'error');
                }, 400);
                
                // Обновляем время последней попытки
                state.dailyRewardLastClaim = Date.now();
                state.dailyRewardStreak = 0;
                saveState();
            } else {
                // Ещё есть попытки
                setTimeout(() => {
                    renderDailyReward();
                    showToast(`💥 Мина! Осталось попыток: ${dailyGameState.attempts}`, 'error');
                }, 400);
            }
        }, 200);
    } else if (cell.type === 'key') {
        // ПОБЕДА! Нашёл единственный ключ!
        dailyGameState.keysFound = 1;
        dailyGameState.gameOver = true;
        dailyGameState.grid.forEach(c => c.revealed = true);
        playSound('levelup');
        window.haptic('success');
        
        // Выдаём награду
        const reward = dailyGameState.reward;

        // Награда звездами в зависимости от редкости
        let starReward = 0;
        if (reward.rarity === 'common') starReward = 1;
        else if (reward.rarity === 'rare') starReward = 2;
        else if (reward.rarity === 'epic') starReward = 3;
        else if (reward.rarity === 'legendary') starReward = 5;
        
        if (starReward > 0) {
            state.stars += starReward;
            showToast(`⭐ +${starReward} звёзд!`, 'success');
        }

        if (reward.effect.type === 'instantSizePercent') {
            const bonus = Math.floor(state.size * reward.effect.value);
            state.size += bonus;
            updateTargetScale();
            showToast(`🎉 ${reward.name}: +${bonus.toLocaleString()} размера!`, 'success');
        } else if (reward.effect.type === 'instantCoinsPercent') {
            const bonus = Math.floor(state.coins * reward.effect.value);
            state.coins += bonus;
            showToast(`🎉 ${reward.name}: +${bonus.toLocaleString()} монет!`, 'success');
        } else if (reward.effect.type === 'jackpot') {
            const sizeBonus = Math.floor(state.size * reward.effect.value);
            const coinBonus = Math.floor(state.coins * reward.effect.value);
            state.size += sizeBonus;
            state.coins += coinBonus;
            updateTargetScale();
            showToast(`👑 ДЖЕКПОТ! +${sizeBonus.toLocaleString()} размера, +${coinBonus.toLocaleString()} монет!`, 'success');
        } else if (reward.duration > 0) {
            // Проверяем, есть ли уже активный буст того же типа
            if (reward.effect.type === 'multiply') {
                const existingBoost = state.activeEffects.find(e =>
                    e.effect.type === 'multiply' && e.endTime > Date.now()
                );
                if (existingBoost) {
                    showToast(`⚠️ Уже активен буст x${existingBoost.effect.value}! Будет использован сильнейший.`, 'warning');
                }
            }
            state.activeEffects.push({ ...reward, endTime: Date.now() + reward.duration });
            processEffects();
            showToast(`🎉 ${reward.name} активирован!`, 'success');
        }

        state.dailyRewardLastClaim = Date.now();
        state.dailyRewardStreak++;
        
        updateUI();
        saveState();
        
        setTimeout(() => renderDailyReward(), 500);
    }
    
    renderDailyReward();
}

function renderDailyReward() {
    const container = els.dailyRewardContent;
    const canClaim = canClaimDaily();
    const timeLeft = getTimeUntilNextDaily();
    
    if (!canClaim) {
        // Показываем таймер до следующей попытки
        container.innerHTML = `
            <div class="daily-info">
                <div class="daily-info-title">⏰ Следующая попытка через:</div>
                <div class="daily-timer" id="dailyTimerDisplay">${formatTimeShort(timeLeft)}</div>
                <div class="daily-streak">🔥 Серия: ${state.dailyRewardStreak} дней</div>
                <div class="daily-info-desc" style="margin-top: 12px;">
                    Возвращайся каждый день, чтобы получить крутые награды!
                </div>
            </div>
        `;
        return;
    }
    
    // Игра доступна
    if (dailyGameState.grid.length === 0) {
        initDailyGame();
    }
    
    const reward = dailyGameState.reward;
    
    const rarityNames = {
        common: 'Обычная',
        rare: 'Редкая',
        epic: 'Эпическая',
        legendary: 'Легендарная'
    };
    
    const rarityColors = {
        common: '#4ade80',
        rare: '#b366ff',
        epic: '#fbbf24',
        legendary: '#ff4d8d'
    };
    
    container.innerHTML = `
        <div class="daily-info">
            <div class="daily-info-title">🎮 Найди ключ!</div>
            <div class="daily-info-desc">У тебя 3 попытки найти единственный ключ 🔑</div>
            <div class="daily-streak">🔥 Серия: ${state.dailyRewardStreak} дней</div>
            <div style="margin-top: 8px; font-size: 11px; color: ${rarityColors[reward.rarity]};">
                Награда: ${rarityNames[reward.rarity]} ✨
            </div>
        </div>
        
        <div class="daily-game">
            <div class="daily-progress">
                Попыток: <span class="keys">${dailyGameState.attempts}/${dailyGameState.maxAttempts}</span>
            </div>
            <div class="daily-grid" id="dailyGrid"></div>
            ${dailyGameState.gameOver && dailyGameState.keysFound >= 1 ? `
                <div class="daily-reward-display" style="border-color: ${rarityColors[reward.rarity]};">
                    <div class="reward-icon">${reward.icon}</div>
                    <div class="reward-name" style="color: ${rarityColors[reward.rarity]};">${reward.name}</div>
                    <div class="reward-desc">${reward.desc}</div>
                    <div style="margin-top: 8px; font-size: 10px; color: ${rarityColors[reward.rarity]}; text-transform: uppercase; letter-spacing: 1px;">
                        ${rarityNames[reward.rarity]}
                    </div>
                </div>
            ` : ''}
        </div>
    `;
    
    const grid = document.getElementById('dailyGrid');
    dailyGameState.grid.forEach((cell, index) => {
        const cellDiv = document.createElement('div');
        cellDiv.className = `daily-cell ${cell.revealed ? 'revealed' : ''} ${cell.revealed && cell.type === 'key' ? 'key' : ''} ${cell.revealed && cell.type === 'bomb' ? 'bomb' : ''} ${dailyGameState.gameOver ? 'disabled' : ''}`;
        
        if (cell.revealed) {
            if (cell.type === 'key') cellDiv.textContent = '🔑';
            else if (cell.type === 'bomb') cellDiv.textContent = '💣';
        } else {
            cellDiv.textContent = '❓';
        }
        
        if (!cell.revealed && !dailyGameState.gameOver) {
            cellDiv.addEventListener('click', () => revealCell(index));
        }
        
        grid.appendChild(cellDiv);
    });
}

async function switchTab(tabId) {
    const targetTab = document.getElementById(tabId);
    const targetNav = document.querySelector(`[data-tab="${tabId}"]`);
    
    if (!targetTab || !targetNav) return;

    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    
    targetTab.classList.add('active');
    targetNav.classList.add('active');
    
    if (tabId === 'upgradeTab') renderUpgrades();
    if (tabId === 'shopTab') renderShop();
    if (tabId === 'casesTab') renderCases();
    if (tabId === 'achTab') updateAchievementsUI();
    if (tabId === 'inventoryTab') renderInventory();
    if (tabId === 'topTab') await renderLeaderboard(); // ЖДЁМ загрузки!
    if (tabId === 'dailyTab') renderDailyReward();
}

function init() {
    // Проверка запуска через Telegram WebApp
    const tg = window.Telegram?.WebApp;
    
    if (!tg) {
        // Запущено не через Telegram
        document.body.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: var(--bg-primary); color: var(--text-primary); text-align: center; padding: 20px;">
                <div>
                    <div style="font-size: 64px; margin-bottom: 20px;">⚠️</div>
                    <h2 style="font-size: 24px; margin-bottom: 10px;">Ошибка запуска</h2>
                    <p style="color: var(--text-secondary); font-size: 14px;">
                        Эта игра работает только в Telegram!<br>
                        Откройте бота в Telegram, чтобы играть.
                    </p>
                </div>
            </div>
        `;
        return;
    }
    
    // Инициализация Firebase
    initFirebase();
    
    els = {
        userAvatar: document.getElementById('userAvatar'),
        avatarLetter: document.getElementById('avatarLetter'),
        userName: document.getElementById('userName'),
        userRank: document.getElementById('userRank'),
        coinCount: document.getElementById('coinCount'),
        sizeCount: document.getElementById('sizeCount'),
        starCount: document.getElementById('starCount'),
        modelSize: document.getElementById('modelSize'),
        modelCanvas: document.getElementById('modelCanvas'),
        modelContainer: document.getElementById('modelContainer'),
        perClickVal: document.getElementById('perClickVal'),
        exchangeAmount: document.getElementById('exchangeAmount'),
        exchangeBtn: document.getElementById('exchangeBtn'),
        exchangeRate: document.querySelector('.exchange-rate'),
        activeEffectsBar: document.getElementById('activeEffectsBar'),
        shopGrid: document.getElementById('shopGrid'),
        shopTimer: document.getElementById('shopTimer'),
        casesGrid: document.getElementById('casesGrid'),

        activeItems: document.getElementById('activeItems'),
        noActive: document.getElementById('noActive'),
        inventoryGrid: document.getElementById('inventoryGrid'),
        noInventory: document.getElementById('noInventory'),
        leaderboardList: document.getElementById('leaderboardList'),
        modalOverlay: document.getElementById('modalOverlay'),
        modalIcon: document.getElementById('modalIcon'),
        modalTitle: document.getElementById('modalTitle'),
        modalDesc: document.getElementById('modalDesc'),
        modalProfileStats: document.getElementById('modalProfileStats'),
        modalAchGrid: document.getElementById('modalAchGrid'),
        modalBtn: document.getElementById('modalBtn'),
        achInfoDisplay: document.getElementById('achInfoDisplay'),
        achInfoTitle: document.getElementById('achInfoTitle'),
        achInfoDesc: document.getElementById('achInfoDesc'),
        toast: document.getElementById('toast'),
        achGrid: document.getElementById('achGrid'),
        achProgress: document.getElementById('achProgress'),

        achInfoBox: document.getElementById('achInfoBox'),
        upgradeGrid: document.getElementById('upgradeGrid'),
        dailyRewardContent: document.getElementById('dailyRewardContent'),
    };

    loadState();
    
    // Telegram Init - используем уже объявленную переменную tg
    if (tg) {
        tg.ready();
        tg.expand();
        try {
            tg.enableClosingConfirmation();
            tg.setHeaderColor(getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim());
            tg.setBackgroundColor(getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim());
        } catch(e) {}
        
        const user = tg.initDataUnsafe?.user;
        if (user) {
            state.userName = user.first_name || 'Игрок';
            state.userId = 'tg_' + user.id;
            if (els.userName) els.userName.textContent = state.userName;
            if (els.avatarLetter) els.avatarLetter.textContent = state.userName.charAt(0);
            if (user.photo_url && els.userAvatar) {
                const img = document.createElement('img');
                img.src = user.photo_url;
                els.userAvatar.innerHTML = '';
                els.userAvatar.appendChild(img);
            }
        }
    } else {
        if (els.userName) els.userName.textContent = 'Игрок';
    }

    // Haptic feedback helper with fallback
    window.haptic = (type = 'light') => {
        const telegram = window.Telegram?.WebApp;
        if (telegram && telegram.HapticFeedback) {
            if (type === 'light') telegram.HapticFeedback.impactOccurred('light');
            else if (type === 'medium') telegram.HapticFeedback.impactOccurred('medium');
            else if (type === 'heavy') telegram.HapticFeedback.impactOccurred('heavy');
            else if (type === 'success') telegram.HapticFeedback.notificationOccurred('success');
            else if (type === 'warning') telegram.HapticFeedback.notificationOccurred('warning');
            else if (type === 'error') telegram.HapticFeedback.notificationOccurred('error');
        } else if (window.navigator?.vibrate) {
            if (type === 'light') window.navigator.vibrate(10);
            else if (type === 'medium') window.navigator.vibrate(20);
            else if (type === 'heavy') window.navigator.vibrate(40);
        }
    };

    initThree();
    
    // ============================================
    // ПРОСТАЯ СИСТЕМА RATE LIMITING (как в Hamster Combat)
    // ============================================
    
    // Настройки
    const MAX_CLICKS_PER_SECOND = 20;  // Максимум 20 кликов в секунду
    let clickQueue = [];
    
    // Функция проверки лимита
    function canProcessClick() {
        const now = Date.now();
        const oneSecondAgo = now - 1000;
        
        // Очищаем старые клики
        clickQueue = clickQueue.filter(time => time > oneSecondAgo);
        
        // Проверяем лимит
        if (clickQueue.length >= MAX_CLICKS_PER_SECOND) {
            return false;  // Лимит достигнут - клик не засчитывается
        }
        
        // Добавляем клик в очередь
        clickQueue.push(now);
        return true;  // Клик засчитан
    }
    
    // Обработчики событий с rate limiting
    els.modelContainer.addEventListener('touchstart', (e) => {
        e.preventDefault();
        
        // Обрабатываем каждое касание
        for (const touch of e.changedTouches) {
            if (canProcessClick()) {
                window.haptic('light');
                handleClick({
                    clientX: touch.clientX,
                    clientY: touch.clientY,
                    target: e.target
                });
            }
        }
    }, { passive: false });
    
    els.modelContainer.addEventListener('touchend', (e) => {
        e.preventDefault();
    }, { passive: false });
    
    els.modelContainer.addEventListener('touchcancel', (e) => {
        e.preventDefault();
    }, { passive: false });
    
    els.modelContainer.addEventListener('mousedown', (e) => {
        if (canProcessClick()) {
            window.haptic('light');
            handleClick(e);
        }
    });
    
    els.modelContainer.addEventListener('contextmenu', (e) => e.preventDefault());
    
    // Для совместимости создаем объект antiCheat
    antiCheat = {
        isBlocked: false,
        suspicionScore: 0,
        getStats: () => ({
            currentCPS: clickQueue.filter(t => Date.now() - t < 1000).length,
            maxCPS: MAX_CLICKS_PER_SECOND
        })
    };
    
    console.log(`✅ Rate Limiting активирован: макс ${MAX_CLICKS_PER_SECOND} CPS`);
    
    els.exchangeBtn.addEventListener('click', () => {
        window.haptic('medium');
        exchangeSize();
    });
    
    document.querySelectorAll('.nav-item').forEach(n => n.addEventListener('click', () => {
        window.haptic('light');
        switchTab(n.dataset.tab);
    }));
    
    els.modalOverlay.addEventListener('click', (e) => { if (e.target === els.modalOverlay) closeModal(); });
    
    // Initial Render
    renderShop();
    renderCases();
    renderUpgrades();
    renderLeaderboard();
    updateAchievementsUI();
    updateUI();
    
    // Game loops
    setInterval(() => {
        if (!document.hidden) state.totalPlayTime += 1000;
        checkAchievements();
        saveState();
    }, 1000);
    
    setInterval(processEffects, 1000);
    
    // Upgrade auto-clicker runs every second
    setInterval(processUpgradeAuto, 1000);
    
    // Refresh upgrades UI periodically when on that tab
    setInterval(() => {
        if (document.getElementById('upgradeTab').classList.contains('active')) {
            renderUpgrades();
        }
    }, 2000);
    
    setInterval(() => {
        const last = parseInt(localStorage.getItem('shopLastUpdate') || Date.now());
        els.shopTimer.textContent = formatTimeShort(Math.max(0, SHOP_REFRESH_MS - (Date.now() - last)));
        
        // Обновляем таймер ежедневной награды если вкладка открыта
        const dailyTimerEl = document.getElementById('dailyTimerDisplay');
        if (dailyTimerEl) {
            dailyTimerEl.textContent = formatTimeShort(getTimeUntilNextDaily());
        }
    }, 1000);
    
    // Handle window resize for Three.js
    window.addEventListener('resize', () => {
        const rect = els.modelContainer.getBoundingClientRect();
        if (camera && renderer) {я
            camera.aspect = rect.width / rect.height;
            camera.updateProjectionMatrix();
            renderer.setSize(rect.width, rect.height);
        }
    });
}

// Particle System
const bgCanvas = document.getElementById('bgCanvas');
if (bgCanvas) {
    const bgCtx = bgCanvas.getContext('2d');
    let width, height;
    let particles = [];
    
    function resizeBg() {
        width = window.innerWidth;
        height = window.innerHeight;
        bgCanvas.width = width;
        bgCanvas.height = height;
    }
    
    window.addEventListener('resize', resizeBg);
    resizeBg();
    
    class Particle {
        constructor() {
            this.reset();
        }
        
        reset() {
            this.x = Math.random() * width;
            this.y = Math.random() * height;
            this.vx = (Math.random() - 0.5) * 0.2;
            this.vy = (Math.random() - 0.5) * 0.2;
            this.size = Math.random() * 2;
            this.alpha = Math.random() * 0.5 + 0.1;
            this.color = Math.random() > 0.5 ? '#ff2e7e' : '#00b4d8';
        }
        
        update() {
            this.x += this.vx;
            this.y += this.vy;
            
            if (this.x < 0 || this.x > width || this.y < 0 || this.y > height) {
                this.reset();
            }
        }
        
        draw() {
            bgCtx.beginPath();
            bgCtx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            bgCtx.fillStyle = this.color;
            bgCtx.globalAlpha = this.alpha;
            bgCtx.fill();
        }
    }
    
    for (let i = 0; i < 50; i++) {
        particles.push(new Particle());
    }
    
    function animateBg() {
        bgCtx.clearRect(0, 0, width, height);
        particles.forEach(p => {
            p.update();
            p.draw();
        });
        requestAnimationFrame(animateBg);
    }
    
    animateBg();
}

document.addEventListener('DOMContentLoaded', init);
    
