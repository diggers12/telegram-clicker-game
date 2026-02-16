// ============================================================
// AntiAutoClicker — система обнаружения автокликеров
// с поддержкой мультитач для Telegram WebApp
// ============================================================

class AntiAutoClicker {
  constructor(gameElement, onValidClick, onCheatDetected) {
    this.el = gameElement;
    this.onValidClick = onValidClick;
    this.onCheatDetected = onCheatDetected;
    
    // ── Настройки ──
    this.config = {
      maxCPS: 18,                    // макс кликов/сек на палец
      maxTotalCPS: 40,               // макс кликов/сек всего
      maxSimultaneousTouches: 5,     // макс одновременных касаний
      analysisWindow: 60,            // сколько кликов хранить для анализа
      minTimingCV: 0.08,             // мин коэфф. вариации интервалов
      minPositionStdDev: 2.5,        // мин разброс позиций (px)
      maxIdenticalPosRatio: 0.55,    // макс доля одинаковых координат
      suspicionThreshold: 65,        // порог блокировки (0-100)
      decayRate: 0.4,                // скорость снижения подозрений/сек
      cooldownMs: 3000,              // кулдаун после блокировки
      entropyMinBits: 1.5,           // мин энтропия интервалов
      maxPerfectIntervalRatio: 0.4,  // макс доля идеально одинаковых интервалов
      burstWindow: 500,              // окно обнаружения burst (мс)
      maxBurstClicks: 12,            // макс кликов за burst окно
    };
    
    // ── Состояние ──
    this.clicks = [];                // история кликов
    this.activeTouches = new Map();  // текущие активные касания
    this.suspicionScore = 0;         // 0-100
    this.isBlocked = false;
    this.blockUntil = 0;
    this.lastDecayTime = Date.now();
    this.sessionStats = {
      totalClicks: 0,
      blockedClicks: 0,
      violations: {},
      startTime: Date.now(),
    };
    
    // ── Fingerprint среды ──
    this.envChecks = this._checkEnvironment();
    
    // ── Привязка событий ──
    this._bindEvents();
    
    // ── Таймер затухания подозрений ──
    this._decayInterval = setInterval(() => this._decaySuspicion(), 200);
  }

  // ==========================================================
  //  ПРИВЯЗКА СОБЫТИЙ
  // ==========================================================
  
  _bindEvents() {
    // Touch события (основные для мобильных)
    this.el.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
    this.el.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: true });
    this.el.addEventListener('touchend', (e) => this._onTouchEnd(e), { passive: false });
    this.el.addEventListener('touchcancel', (e) => this._onTouchCancel(e), { passive: true });
    
    // Mouse fallback (для десктопного тестирования)
    this.el.addEventListener('mousedown', (e) => this._onMouseDown(e));
    this.el.addEventListener('mouseup', (e) => this._onMouseUp(e));
    this.el.addEventListener('mousemove', (e) => this._onMouseMove(e));
    
    // Предотвращаем контекстное меню
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  
  // ==========================================================
  //  ОБРАБОТЧИКИ TOUCH
  // ==========================================================
  
  _onTouchStart(e) {
    e.preventDefault();
    
    const now = Date.now();
    
    // Проверяем количество одновременных касаний
    if (e.touches.length > this.config.maxSimultaneousTouches) {
      this._addSuspicion(30, 'too_many_touches');
      return;
    }
    
    // Обрабатываем каждое новое касание
    for (const touch of e.changedTouches) {
      const touchData = {
        id: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY,
        startTime: now,
        moved: false,
        moveDistance: 0,
        radiusX: touch.radiusX || 0,
        radiusY: touch.radiusY || 0,
        force: touch.force || 0,
        rotationAngle: touch.rotationAngle || 0,
      };
      
      this.activeTouches.set(touch.identifier, touchData);
      this._processClick(touch.clientX, touch.clientY, now, touch);
    }
  }
  
  _onTouchMove(e) {
    for (const touch of e.changedTouches) {
      const data = this.activeTouches.get(touch.identifier);
      if (data) {
        const dx = touch.clientX - data.startX;
        const dy = touch.clientY - data.startY;
        data.moveDistance = Math.sqrt(dx * dx + dy * dy);
        data.moved = data.moveDistance > 5;
      }
    }
  }
  
  _onTouchEnd(e) {
    for (const touch of e.changedTouches) {
      const data = this.activeTouches.get(touch.identifier);
      if (data) {
        data.endTime = Date.now();
        data.duration = data.endTime - data.startTime;
        this.activeTouches.delete(touch.identifier);
      }
    }
  }
  
  _onTouchCancel(e) {
    for (const touch of e.changedTouches) {
      this.activeTouches.delete(touch.identifier);
    }
  }
  
  // ==========================================================
  //  ОБРАБОТЧИКИ MOUSE
  // ==========================================================
  
  _onMouseDown(e) {
    // Игнорируем если были touch-события (чтобы не дублировать)
    if (this.clicks.length > 0 && this.clicks[this.clicks.length - 1].inputType === 'touch') {
      return;
    }
    this._processClick(e.clientX, e.clientY, Date.now(), null, e);
  }
  
  _onMouseUp() { }
  _onMouseMove(e) {
    this._lastMouseMove = Date.now();
  }

  // ==========================================================
  //  ОСНОВНАЯ ОБРАБОТКА КЛИКА
  // ==========================================================
  
  _processClick(x, y, timestamp, touchEvent, mouseEvent) {
    const event = touchEvent || mouseEvent;
    
    // ── Проверка isTrusted ──
    const parentEvent = touchEvent?.__parentEvent || mouseEvent;
    if (parentEvent && parentEvent.isTrusted === false) {
      this._addSuspicion(50, 'untrusted_event');
      return;
    }
    
    // ── Проверка блокировки ──
    if (this.isBlocked) {
      if (timestamp < this.blockUntil) {
        this.sessionStats.blockedClicks++;
        return;
      }
      this.isBlocked = false;
      this.suspicionScore = Math.max(0, this.suspicionScore - 20);
    }
    
    // ── Сохраняем клик ──
    const clickRecord = {
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      time: timestamp,
      inputType: touchEvent ? 'touch' : 'mouse',
      radiusX: touchEvent?.radiusX || 0,
      radiusY: touchEvent?.radiusY || 0,
      force: touchEvent?.force || 0,
      activeTouches: this.activeTouches.size,
    };
    
    this.clicks.push(clickRecord);
    
    // Ограничиваем размер истории
    if (this.clicks.length > this.config.analysisWindow * 2) {
      this.clicks = this.clicks.slice(-this.config.analysisWindow);
    }
    
    // ── Запускаем анализ (если достаточно данных) ──
    if (this.clicks.length >= 5) {
      this._analyzePattern();
    }
    
    // ── Если не заблокированы — валидный клик ──
    if (!this.isBlocked) {
      this.sessionStats.totalClicks++;
      if (typeof this.onValidClick === 'function') {
        this.onValidClick({
          x, y,
          timestamp,
          suspicionScore: this.suspicionScore,
          activeTouches: this.activeTouches.size + 1,
        });
      }
    }
  }
  
  // ==========================================================
  //  АНАЛИЗ ПАТТЕРНОВ (ОСНОВНОЙ МЕТОД)
  // ==========================================================
  
  _analyzePattern() {
    const recent = this.clicks.slice(-this.config.analysisWindow);
    if (recent.length < 5) return;
    
    // Сбрасываем разовые проверки
    let violations = [];
    
    // ── 1. Проверка CPS (Clicks Per Second) ──
    violations.push(...this._checkCPS(recent));
    
    // ── 2. Проверка вариативности интервалов ──
    violations.push(...this._checkTimingVariance(recent));
    
    // ── 3. Проверка позиционного разброса ──
    violations.push(...this._checkPositionVariance(recent));
    
    // ── 4. Проверка энтропии интервалов ──
    violations.push(...this._checkTimingEntropy(recent));
    
    // ── 5. Проверка идеальных интервалов ──
    violations.push(...this._checkPerfectIntervals(recent));
    
    // ── 6. Проверка burst-кликов ──
    violations.push(...this._checkBurstClicks(recent));
    
    // ── 7. Проверка touch-метаданных ──
    violations.push(...this._checkTouchMetadata(recent));
    
    // ── 8. Проверка геометрических паттернов ──
    violations.push(...this._checkGeometricPatterns(recent));
    
    // ── 9. Проверка отсутствия человеческих пауз ──
    violations.push(...this._checkHumanPauses(recent));
    
    // ── 10. Проверка корреляции координат ──
    violations.push(...this._checkCoordinateCorrelation(recent));
    
    // Применяем нарушения
    for (const v of violations) {
      this._addSuspicion(v.score, v.reason);
    }
    
    // Проверяем порог
    if (this.suspicionScore >= this.config.suspicionThreshold) {
      this._blockUser();
    }
  }

  // ==========================================================
  //  ПРОВЕРКА 1: CPS
  // ==========================================================
  
  _checkCPS(clicks) {
    const violations = [];
    const now = clicks[clicks.length - 1].time;
    
    // CPS за последнюю секунду
    const lastSecond = clicks.filter(c => now - c.time < 1000);
    const cps = lastSecond.length;
    
    if (cps > this.config.maxTotalCPS) {
      violations.push({
        score: 15 + (cps - this.config.maxTotalCPS) * 2,
        reason: `high_cps:${cps}`,
      });
    }
    
    // CPS на "палец" — группируем по близким координатам
    const fingerGroups = this._groupByFingerPosition(lastSecond, 50);
    for (const group of fingerGroups) {
      if (group.length > this.config.maxCPS) {
        violations.push({
          score: 12,
          reason: `high_finger_cps:${group.length}`,
        });
      }
    }
    
    return violations;
  }
  
  // ==========================================================
  //  ПРОВЕРКА 2: ВАРИАТИВНОСТЬ ИНТЕРВАЛОВ
  // ==========================================================
  
  _checkTimingVariance(clicks) {
    const violations = [];
    const intervals = this._getIntervals(clicks);
    if (intervals.length < 8) return violations;
    
    const stats = this._calcStats(intervals);
    
    // Коэффициент вариации (CV = stddev / mean)
    if (stats.mean > 0) {
      const cv = stats.stdDev / stats.mean;
      if (cv < this.config.minTimingCV) {
        violations.push({
          score: 20 * (1 - cv / this.config.minTimingCV),
          reason: `low_timing_cv:${cv.toFixed(4)}`,
        });
      }
    }
    
    // Слишком стабильный ритм — проверяем скользящим окном
    const windowSize = 10;
    for (let i = 0; i <= intervals.length - windowSize; i++) {
      const window = intervals.slice(i, i + windowSize);
      const wStats = this._calcStats(window);
      if (wStats.mean > 0 && wStats.stdDev / wStats.mean < 0.03) {
        violations.push({
          score: 8,
          reason: 'robotic_rhythm_window',
        });
        break;
      }
    }
    
    return violations;
  }
  
  // ==========================================================
  //  ПРОВЕРКА 3: ПОЗИЦИОННЫЙ РАЗБРОС
  // ==========================================================
  
  _checkPositionVariance(clicks) {
    const violations = [];
    if (clicks.length < 10) return violations;
    
    const xs = clicks.map(c => c.x);
    const ys = clicks.map(c => c.y);
    
    const xStats = this._calcStats(xs);
    const yStats = this._calcStats(ys);
    
    // Слишком маленький разброс позиций
    const posStdDev = Math.sqrt(xStats.variance + yStats.variance);
    if (posStdDev < this.config.minPositionStdDev) {
      violations.push({
        score: 15,
        reason: `low_position_variance:${posStdDev.toFixed(2)}`,
      });
    }
    
    // Проверяем долю идентичных позиций
    const posMap = new Map();
    for (const c of clicks) {
      // Округляем до пикселя
      const key = `${Math.round(c.x)},${Math.round(c.y)}`;
      posMap.set(key, (posMap.get(key) || 0) + 1);
    }
    
    const maxSamePos = Math.max(...posMap.values());
    const sameRatio = maxSamePos / clicks.length;
    
    if (sameRatio > this.config.maxIdenticalPosRatio) {
      violations.push({
        score: 18 * (sameRatio - this.config.maxIdenticalPosRatio) /
               (1 - this.config.maxIdenticalPosRatio),
        reason: `identical_positions:${(sameRatio * 100).toFixed(1)}%`,
      });
    }
    
    return violations;
  }

  // ==========================================================
  //  ПРОВЕРКА 4: ЭНТРОПИЯ ИНТЕРВАЛОВ
  // ==========================================================
  
  _checkTimingEntropy(clicks) {
    const violations = [];
    const intervals = this._getIntervals(clicks);
    if (intervals.length < 15) return violations;
    
    // Квантуем интервалы в бакеты по 5мс
    const bucketSize = 5;
    const buckets = new Map();
    for (const interval of intervals) {
      const bucket = Math.round(interval / bucketSize) * bucketSize;
      buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
    }
    
    // Вычисляем энтропию Шеннона
    const total = intervals.length;
    let entropy = 0;
    for (const count of buckets.values()) {
      const p = count / total;
      if (p > 0) {
        entropy -= p * Math.log2(p);
      }
    }
    
    if (entropy < this.config.entropyMinBits) {
      violations.push({
        score: 15 * (1 - entropy / this.config.entropyMinBits),
        reason: `low_entropy:${entropy.toFixed(3)}bits`,
      });
    }
    
    return violations;
  }
  
  // ==========================================================
  //  ПРОВЕРКА 5: ИДЕАЛЬНЫЕ ИНТЕРВАЛЫ
  // ==========================================================
  
  _checkPerfectIntervals(clicks) {
    const violations = [];
    const intervals = this._getIntervals(clicks);
    if (intervals.length < 10) return violations;
    
    // Считаем пары интервалов с разницей <= 1мс
    let perfectPairs = 0;
    for (let i = 1; i < intervals.length; i++) {
      if (Math.abs(intervals[i] - intervals[i - 1]) <= 1) {
        perfectPairs++;
      }
    }
    
    const ratio = perfectPairs / (intervals.length - 1);
    if (ratio > this.config.maxPerfectIntervalRatio) {
      violations.push({
        score: 20 * ratio,
        reason: `perfect_intervals:${(ratio * 100).toFixed(1)}%`,
      });
    }
    
    // Проверка периодичности через автокорреляцию
    const autoCorr = this._autocorrelation(intervals);
    if (autoCorr > 0.85) {
      violations.push({
        score: 18,
        reason: `high_autocorrelation:${autoCorr.toFixed(3)}`,
      });
    }
    
    return violations;
  }
  
  // ==========================================================
  //  ПРОВЕРКА 6: BURST КЛИКИ
  // ==========================================================
  
  _checkBurstClicks(clicks) {
    const violations = [];
    const now = clicks[clicks.length - 1].time;
    
    const burst = clicks.filter(c => now - c.time < this.config.burstWindow);
    if (burst.length > this.config.maxBurstClicks) {
      violations.push({
        score: 10 + (burst.length - this.config.maxBurstClicks) * 3,
        reason: `burst:${burst.length}in${this.config.burstWindow}ms`,
      });
    }
    
    return violations;
  }
  
  // ==========================================================
  //  ПРОВЕРКА 7: TOUCH МЕТАДАННЫЕ
  // ==========================================================
  
  _checkTouchMetadata(clicks) {
    const violations = [];
    const touchClicks = clicks.filter(c => c.inputType === 'touch');
    if (touchClicks.length < 10) return violations;
    
    // Проверяем radiusX/radiusY — у автокликеров часто 0 или одинаковые
    const radii = touchClicks.map(c => c.radiusX + c.radiusY);
    const allZero = radii.every(r => r === 0);
    const allSame = radii.every(r => r === radii[0]);
    
    if (touchClicks.length > 15 && allZero) {
      // Некоторые устройства действительно не поддерживают — мягкая проверка
      violations.push({
        score: 5,
        reason: 'zero_touch_radius',
      });
    }
    
    if (!allZero && allSame && touchClicks.length > 15) {
      violations.push({
        score: 10,
        reason: 'identical_touch_radius',
      });
    }
    
    // Проверяем force — если поддерживается, должен варьироваться
    const forces = touchClicks.map(c => c.force).filter(f => f > 0);
    if (forces.length > 10) {
      const forceStats = this._calcStats(forces);
      if (forceStats.stdDev < 0.001) {
        violations.push({
          score: 10,
          reason: 'constant_force',
        });
      }
    }
    
    return violations;
  }

  // ==========================================================
  //  ПРОВЕРКА 8: ГЕОМЕТРИЧЕСКИЕ ПАТТЕРНЫ
  // ==========================================================
  
  _checkGeometricPatterns(clicks) {
    const violations = [];
    if (clicks.length < 12) return violations;
    
    // Проверяем, не лежат ли точки на сетке
    const xs = clicks.map(c => Math.round(c.x));
    const ys = clicks.map(c => Math.round(c.y));
    
    // Поиск повторяющегося паттерна координат (цикл)
    const coords = clicks.map(c => `${Math.round(c.x)},${Math.round(c.y)}`);
    const cycleLen = this._detectCycle(coords);
    
    if (cycleLen > 0 && cycleLen <= 10) {
      violations.push({
        score: 25,
        reason: `coordinate_cycle:len=${cycleLen}`,
      });
    }
    
    // Проверяем равномерное распределение по линии
    if (clicks.length >= 20) {
      const linearity = this._checkLinearity(xs, ys);
      if (linearity > 0.98) {
        violations.push({
          score: 12,
          reason: `linear_pattern:${linearity.toFixed(3)}`,
        });
      }
    }
    
    return violations;
  }
  
  // ==========================================================
  //  ПРОВЕРКА 9: ЧЕЛОВЕЧЕСКИЕ ПАУЗЫ
  // ==========================================================
  
  _checkHumanPauses(clicks) {
    const violations = [];
    if (clicks.length < 30) return violations;
    
    const intervals = this._getIntervals(clicks);
    const sessionDuration = clicks[clicks.length - 1].time - clicks[0].time;
    
    // Человек обычно делает микро-паузы (>300ms) хотя бы иногда
    if (sessionDuration > 10000) { // 10+ секунд кликов
      const pauses = intervals.filter(i => i > 300);
      const pauseRatio = pauses.length / intervals.length;
      
      if (pauseRatio < 0.02 && intervals.length > 25) {
        violations.push({
          score: 10,
          reason: `no_human_pauses:${(pauseRatio * 100).toFixed(1)}%`,
        });
      }
    }
    
    // Проверяем монотонность — человек устаёт, скорость меняется
    if (intervals.length >= 40) {
      const firstHalf = intervals.slice(0, Math.floor(intervals.length / 2));
      const secondHalf = intervals.slice(Math.floor(intervals.length / 2));
      const firstMean = this._calcStats(firstHalf).mean;
      const secondMean = this._calcStats(secondHalf).mean;
      
      // Если средние интервалы почти идентичны на длинном промежутке — подозрительно
      if (Math.abs(firstMean - secondMean) / Math.max(firstMean, secondMean) < 0.01) {
        violations.push({
          score: 8,
          reason: 'no_fatigue_pattern',
        });
      }
    }
    
    return violations;
  }
  
  // ==========================================================
  //  ПРОВЕРКА 10: КОРРЕЛЯЦИЯ КООРДИНАТ
  // ==========================================================
  
  _checkCoordinateCorrelation(clicks) {
    const violations = [];
    if (clicks.length < 15) return violations;
    
    // Проверяем автокорреляцию координат
    const xs = clicks.map(c => c.x);
    const ys = clicks.map(c => c.y);
    
    // Разности последовательных координат
    const dx = [];
    const dy = [];
    for (let i = 1; i < clicks.length; i++) {
      dx.push(clicks[i].x - clicks[i - 1].x);
      dy.push(clicks[i].y - clicks[i - 1].y);
    }
    
    // Если все дельты одинаковые — автокликер перемещается по паттерну
    if (dx.length > 10) {
      const dxStats = this._calcStats(dx);
      const dyStats = this._calcStats(dy);
      
      if (dxStats.stdDev < 0.1 && dyStats.stdDev < 0.1 &&
          dxStats.mean === 0 && dyStats.mean === 0) {
        // Все клики в одну точку — уже покрыто позиционной проверкой
      } else if (dxStats.stdDev < 0.5 && dyStats.stdDev < 0.5 &&
                 (Math.abs(dxStats.mean) > 0.1 || Math.abs(dyStats.mean) > 0.1)) {
        violations.push({
          score: 15,
          reason: 'systematic_movement',
        });
      }
    }
    
    return violations;
  }

  // ==========================================================
  //  ПРОВЕРКА СРЕДЫ
  // ==========================================================
  
  _checkEnvironment() {
    const flags = {};
    
    // Проверка WebDriver
    if (navigator.webdriver) {
      flags.webdriver = true;
      this._addSuspicion(40, 'webdriver_detected');
    }
    
    // Проверка Headless Chrome
    if (/HeadlessChrome/.test(navigator.userAgent)) {
      flags.headless = true;
      this._addSuspicion(50, 'headless_browser');
    }
    
    // Проверка автоматизации
    const automationProps = [
      '__selenium_unwrapped', '__webdriver_evaluate',
      '__driver_evaluate', '__webdriver_unwrapped',
      '__fxdriver_evaluate', '_phantom', '__nightmare',
      'callPhantom', '_selenium', 'calledSelenium',
      'domAutomation', 'domAutomationController',
    ];
    
    for (const prop of automationProps) {
      if (prop in window || prop in document) {
        flags.automation = prop;
        this._addSuspicion(50, `automation:${prop}`);
        break;
      }
    }
    
    // Проверка devtools (базовая)
    const devtools = { open: false };
    const threshold = 160;
    const check = () => {
      if (window.outerWidth - window.innerWidth > threshold ||
          window.outerHeight - window.innerHeight > threshold) {
        devtools.open = true;
      }
    };
    check();
    if (devtools.open) {
      flags.devtools = true;
      // Мягкое подозрение — разработчик может тестировать
      this._addSuspicion(5, 'devtools_open');
    }
    
    // Проверяем Telegram WebApp
    if (window.Telegram?.WebApp) {
      flags.telegramWebApp = true;
    }
    
    return flags;
  }
  
  // ==========================================================
  //  УПРАВЛЕНИЕ ПОДОЗРЕНИЯМИ
  // ==========================================================
  
  _addSuspicion(amount, reason) {
    const prev = this.suspicionScore;
    this.suspicionScore = Math.min(100, this.suspicionScore + amount);
    
    // Логируем нарушение
    if (!this.sessionStats.violations[reason]) {
      this.sessionStats.violations[reason] = 0;
    }
    this.sessionStats.violations[reason]++;
    
    console.debug(
      `[AntiCheat] +${amount} suspicion (${reason}) ` +
      `| ${prev.toFixed(1)} → ${this.suspicionScore.toFixed(1)}`
    );
  }
  
  _decaySuspicion() {
    const now = Date.now();
    const elapsed = (now - this.lastDecayTime) / 1000;
    this.lastDecayTime = now;
    
    if (this.suspicionScore > 0 && !this.isBlocked) {
      this.suspicionScore = Math.max(
        0,
        this.suspicionScore - this.config.decayRate * elapsed
      );
    }
  }
  
  _blockUser() {
    this.isBlocked = true;
    this.blockUntil = Date.now() + this.config.cooldownMs;
    
    console.warn(
      `[AntiCheat] BLOCKED! Score: ${this.suspicionScore.toFixed(1)} ` +
      `| Cooldown: ${this.config.cooldownMs}ms`
    );
    
    if (typeof this.onCheatDetected === 'function') {
      this.onCheatDetected({
        score: this.suspicionScore,
        violations: { ...this.sessionStats.violations },
        blockedUntil: this.blockUntil,
        stats: this.getStats(),
      });
    }
    
    // Увеличиваем кулдаун при повторных блокировках
    this.config.cooldownMs = Math.min(30000, this.config.cooldownMs * 1.5);
  }

  // ==========================================================
  //  УТИЛИТЫ: МАТЕМАТИКА И СТАТИСТИКА
  // ==========================================================
  
  _getIntervals(clicks) {
    const intervals = [];
    for (let i = 1; i < clicks.length; i++) {
      intervals.push(clicks[i].time - clicks[i - 1].time);
    }
    return intervals;
  }
  
  _calcStats(arr) {
    if (arr.length === 0) return { mean: 0, variance: 0, stdDev: 0, min: 0, max: 0 };
    
    const n = arr.length;
    const mean = arr.reduce((a, b) => a + b, 0) / n;
    const variance = arr.reduce((sum, x) => sum + (x - mean) ** 2, 0) / n;
    const stdDev = Math.sqrt(variance);
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    
    return { mean, variance, stdDev, min, max };
  }
  
  _autocorrelation(arr, lag = 1) {
    if (arr.length < lag + 2) return 0;
    
    const n = arr.length;
    const mean = arr.reduce((a, b) => a + b, 0) / n;
    
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      den += (arr[i] - mean) ** 2;
      if (i + lag < n) {
        num += (arr[i] - mean) * (arr[i + lag] - mean);
      }
    }
    
    return den === 0 ? 0 : num / den;
  }
  
  _detectCycle(arr) {
    if (arr.length < 6) return -1;
    
    for (let cycleLen = 2; cycleLen <= Math.min(10, Math.floor(arr.length / 2)); cycleLen++) {
      let matches = 0;
      let checks = 0;
      
      for (let i = cycleLen; i < arr.length; i++) {
        checks++;
        if (arr[i] === arr[i % cycleLen]) {
          matches++;
        }
      }
      
      if (checks > 0 && matches / checks > 0.9) {
        return cycleLen;
      }
    }
    
    return -1;
  }
  
  _checkLinearity(xs, ys) {
    const n = xs.length;
    if (n < 3) return 0;
    
    // Pearson correlation coefficient
    const xMean = xs.reduce((a, b) => a + b, 0) / n;
    const yMean = ys.reduce((a, b) => a + b, 0) / n;
    
    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - xMean;
      const dy = ys[i] - yMean;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }
    
    const den = Math.sqrt(denX * denY);
    return den === 0 ? 0 : Math.abs(num / den);
  }
  
  _groupByFingerPosition(clicks, radius) {
    const groups = [];
    const used = new Set();
    
    for (let i = 0; i < clicks.length; i++) {
      if (used.has(i)) continue;
      
      const group = [clicks[i]];
      used.add(i);
      
      for (let j = i + 1; j < clicks.length; j++) {
        if (used.has(j)) continue;
        const dx = clicks[i].x - clicks[j].x;
        const dy = clicks[i].y - clicks[j].y;
        if (Math.sqrt(dx * dx + dy * dy) < radius) {
          group.push(clicks[j]);
          used.add(j);
        }
      }
      
      groups.push(group);
    }
    
    return groups;
  }
  
  // ==========================================================
  //  ПУБЛИЧНЫЕ МЕТОДЫ
  // ==========================================================
  
  getStats() {
    return {
      totalClicks: this.sessionStats.totalClicks,
      blockedClicks: this.sessionStats.blockedClicks,
      suspicionScore: Math.round(this.suspicionScore * 10) / 10,
      isBlocked: this.isBlocked,
      sessionDuration: Date.now() - this.sessionStats.startTime,
      violations: { ...this.sessionStats.violations },
      clickHistory: this.clicks.length,
    };
  }
  
  reset() {
    this.clicks = [];
    this.suspicionScore = 0;
    this.isBlocked = false;
    this.blockUntil = 0;
    this.config.cooldownMs = 3000;
    this.sessionStats = {
      totalClicks: 0,
      blockedClicks: 0,
      violations: {},
      startTime: Date.now(),
    };
  }
  
  destroy() {
    clearInterval(this._decayInterval);
    // Можно добавить удаление event listener-ов через AbortController
  }
  
  // Ручная настройка чувствительности
  setSensitivity(level) {
    // level: 'low', 'medium', 'high', 'paranoid'
    const presets = {
      low: {
        suspicionThreshold: 85,
        maxCPS: 25,
        maxTotalCPS: 50,
        minTimingCV: 0.04,
        entropyMinBits: 1.0,
      },
      medium: {
        suspicionThreshold: 65,
        maxCPS: 18,
        maxTotalCPS: 40,
        minTimingCV: 0.08,
        entropyMinBits: 1.5,
      },
      high: {
        suspicionThreshold: 50,
        maxCPS: 14,
        maxTotalCPS: 30,
        minTimingCV: 0.12,
        entropyMinBits: 2.0,
      },
      paranoid: {
        suspicionThreshold: 35,
        maxCPS: 10,
        maxTotalCPS: 22,
        minTimingCV: 0.15,
        entropyMinBits: 2.5,
      },
    };
    
    if (presets[level]) {
      Object.assign(this.config, presets[level]);
    }
  }
}

// Экспорт для использования в других модулях
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AntiAutoClicker;
}
