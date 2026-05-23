// ==========================================
// 拾字 - 文字选择工具
// ShortX / Rhino ES5 悬浮文字选择与翻译脚本
// 如拾贝壳，收集文字
// ==========================================
// 来源: 阿然博客 xin-blog.com
// ==========================================

(function() {
    'use strict';
    
    // ==========================================
    // 拾字 - DIY 自定义配置区
    // ==========================================
    var DIY_CONFIG = {
        // 翻译引擎选择：1 = 百度翻译，2 = 有道翻译。
        // 也可在 ShortX 局部变量「翻译引擎」里填 1 或 2 覆盖这里。
        TRANSLATE_API: typeof localVarOf$翻译引擎 !== 'undefined' ? localVarOf$翻译引擎 : 1,            
        
        // 最大允许载入的字符数。数值越大可处理长文越多，但首次排版、选区刷新、放大镜镜像都会更吃性能。
        // 建议：普通手机 3000~5000；性能较好可 8000；如果首屏仍慢，可先降到 3000 验证。
        MAX_CHAR_LIMIT: 8000,

        // 主文本区最大高度(dp)。数值越大，单屏显示行数越多，但窗口更高、布局测量更重。
        // 建议：手机 360~420；平板 480~560；如果遮挡严重可调小。
        TEXT_AREA_HEIGHT_DP: 420,
        
        // 边缘下拉/上推滚动时的自动滚动刷新延迟(ms)。
        // 数值越小滚动越丝滑，但 MOVE/选区/放大镜刷新更频繁，更吃 CPU。
        // 建议：60Hz 用 16~24；90Hz 用 11~16；120Hz 用 8~12；卡顿时优先调大到 16 或 24。
        // 常见屏幕刷新率 (FPS) 的换算参考值：
        // 30 帧/秒  ≈ 33
        // 60 帧/秒  ≈ 16
        // 90 帧/秒  ≈ 11
        // 120 帧/秒 ≈ 8
        // 144 帧/秒 ≈ 7
        SCROLL_DELAY_MS: 10           
    };

    var appContext;
    try {
        if (typeof context === 'undefined' || context == null) {
            return;
        }
        appContext = context.getApplicationContext ? context.getApplicationContext() : context;
    } catch (e) {
        return;
    }
    
    var LayoutParams = android.view.WindowManager.LayoutParams;
    var LinearLayout = android.widget.LinearLayout;
    var TextView = android.widget.TextView;
    var Button = android.widget.Button;
    var ImageView = android.widget.ImageView;
    var FrameLayout = android.widget.FrameLayout;
    var ScrollView = android.widget.ScrollView;
    var SeekBar = android.widget.SeekBar;
    var GradientDrawable = android.graphics.drawable.GradientDrawable;
    var Color = android.graphics.Color;
    var MotionEvent = android.view.MotionEvent;
    var Gravity = android.view.Gravity;
    var TypedValue = android.util.TypedValue;
    var View = android.view.View;
    var Handler = android.os.Handler;
    var Looper = android.os.Looper;
    var SpannableString = android.text.SpannableString;
    var SpannableStringBuilder = android.text.SpannableStringBuilder;
    var BackgroundColorSpan = android.text.style.BackgroundColorSpan;
    var ForegroundColorSpan = android.text.style.ForegroundColorSpan;
    var Bitmap = android.graphics.Bitmap;
    var Canvas = android.graphics.Canvas;
    var Paint = android.graphics.Paint;
    var Path = android.graphics.Path;

    var mainHandler = new Handler(Looper.getMainLooper());
    var keepAliveTimer = null;

    var PREFS_NAME = "拾字Prefs";
    var KEY_FONT_SIZE = "fontSize";
    // 字号范围：设置面板里的滑块上下限。调太小不易点选，调太大容易增加排版高度。
    var MIN_FONT_SIZE = 12;
    var MAX_FONT_SIZE = 32;
    var DEFAULT_FONT_SIZE = 20;      // 默认字号；首次使用或读取失败时采用此值，后续会记住用户滑块选择。
    var currentFontSize = DEFAULT_FONT_SIZE;
    var windowManager = null;
    var mainLayout = null;
    var layoutParams = null;
    var textView = null;
    var previewTextView = null;
    var seekBar = null;
    var fontSizeLabel = null;
    var scrollView = null;
    var countLabelView = null;
    var copyActionBtn = null;
    var translateActionBtn = null;
    var selectAllActionBtn = null;
    var clearActionBtn = null;
    var titleBarRefs = { normalMode: null, settingMode: null };
    
    var fullText = "";
    var spannable = null;
    var addedSpans = []; // 自己用 JS 数组记录 Span，彻底避开 Java 反射的坑
    var selectedIndices = [];
    var lastTranslationState = null;
    
    var isDragging = false;
    var isTranslating = false; // 并发锁
    var dragStartIndex = -1;
    var lastDragIndex = -1;
    var isLongPress = false;
    var dragSnapshot = [];
    var longPressHandler = null;
    var touchDownTime = 0;
    var touchDownX = 0;
    var touchDownY = 0;
    var touchDownRawX = 0;
    var touchDownRawY = 0;
    var isShowing = false;
    var selectedSet = {};
    
    var cachedLayout = null;
    var pendingUpdate = false;
    var pendingAdjustRunnable = null;
    
    var lastDragUpdateTime = 0;
    // 拖选刷新节流(ms)：数值越小选区跟手越及时，但高频 setSpan 更吃性能；卡顿时可调到 32~40。
    var DRAG_UPDATE_INTERVAL = 24;
    var pendingDragUpdate = null; 
    var lastDragEnd = -1;
    
    var autoScrollRunnable = null;
    var lastTouchX = 0;
    var lastTouchY = 0;
    var lastTouchRawX = 0;
    var lastTouchRawY = 0;
    var isAutoScrolling = false;
    // 边缘自动滚动触发区比例：0.15 表示顶部/底部 15% 区域触发自动滚动。
    // 调大更容易触发滚动；调小可减少误触。
    var SCROLL_EDGE_TOP = 0.15; 
    var SCROLL_EDGE_BOTTOM = 0.15;
    // 自动滚动速度范围(dp/帧近似值)：数值越大，拖到边缘时滚动越快。
    var SCROLL_MIN_SPEED = 5; 
    var SCROLL_MAX_SPEED = 25;

    var fingerPreviewLayout = null;       // 全屏透明容器，避免每帧 updateViewLayout
    var fingerPreviewCircle = null;       // 真正可见的圆形预览层
    var fingerPreviewMirrorText = null;
    var fingerPreviewParams = null;
    var fingerPreviewLastIndex = -1;
    var fingerPreviewLastUpdateTime = 0;
    var fingerPreviewLastContentUpdateTime = 0;
    var fingerPreviewLastX = -9999;
    var fingerPreviewLastY = -9999;
    var fingerPreviewMirrorReady = false;
    var fingerPreviewMirrorContentDirty = false;
    var fingerPreviewMirrorLastBindTime = 0;
    var fingerPreviewMirrorSpans = [];
    var fingerPreviewCreateErrorShown = false;

    // 放大镜大小(dp)：越大越容易看清，但全屏 overlay 与镜像 TextView 绘制成本更高。
    var FINGER_PREVIEW_SIZE_DP = 108;
    // 放大镜相对手指的上移距离(dp)：越大越靠上，避免被手指挡住；太大可能贴近屏幕顶部。
    var FINGER_PREVIEW_OFFSET_Y_DP = 185;
    // 放大倍数：越大文字越清楚，但镜像内容尺寸越大、首次同步越重。
    var FINGER_PREVIEW_ZOOM = 1.35;
    // 放大镜位置刷新间隔(ms)：16 约等于 60fps；卡顿时可调 24~33。
    var FINGER_PREVIEW_INTERVAL = 16;
    // 放大镜内容/选中态刷新间隔(ms)：越小同步越及时，越大越省性能。
    var FINGER_PREVIEW_CONTENT_INTERVAL = 24;
    // 放大镜镜像全文重绑间隔(ms)：防止频繁 setText；一般不建议低于 100。
    var FINGER_PREVIEW_TEXT_REBIND_INTERVAL = 200;
    // 放大镜移动阈值(px)：手指移动超过该值才更新圆形位置；调大可减少轻微抖动和刷新次数。
    var FINGER_PREVIEW_MOVE_THRESHOLD_PX = 1;

    // 长文本首屏加载策略：先显示前 N 字，让窗口先出来，再延迟补全全文。
    // 调大可减少“二次补全文”感，但首屏更慢；调小首屏更快，但长文会更明显地分段加载。
    var INITIAL_TEXT_FAST_LIMIT = 1500;
    // 主 UI 创建后延迟多少 ms 再填入文本。给窗口 addView/入场动画让路，避免首屏阻塞。
    var INITIAL_TEXT_DELAY_MS = 60;
    // 完整长文本补全延迟(ms)。建议晚于首屏动画和放大镜预热；太小会重新卡首屏，太大用户等待更久。
    var FULL_TEXT_DELAY_MS = 1200;
    var pendingFullTextRunnable = null;
    var pendingFingerPreviewWarmupRunnable = null;
    var isPartialTextLoaded = false;
    var originalFullText = "";
    
    // 翻译 API 统一鉴权配置读取
    var API_APP_ID = typeof localVarOf$应用ID !== 'undefined' ? localVarOf$应用ID : "";
    var API_APP_SECRET = typeof localVarOf$应用秘钥 !== 'undefined' ? localVarOf$应用秘钥 : ""; 
    var BD_API_URL = "https://fanyi-api.baidu.com/api/trans/vip/translate";
    var YD_API_URL = "https://openapi.youdao.com/api";
    
    // ==========================================
    // 翻译引擎核心辅助函数
    // ==========================================
    function md5(str) {
        try {
            var md = java.security.MessageDigest.getInstance("MD5");
            md.update(new java.lang.String(str).getBytes("UTF-8"));
            var bytes = md.digest();
            var sb = new java.lang.StringBuilder();
            for (var i = 0; i < bytes.length; i++) {
                var tmp = java.lang.Integer.toHexString(bytes[i] & 0xFF);
                if (tmp.length() == 1) { sb.append("0"); }
                sb.append(tmp);
            }
            return sb.toString();
        } catch (e) { return ""; }
    }
    
    function sha256(str) {
        try {
            var md = java.security.MessageDigest.getInstance("SHA-256");
            md.update(new java.lang.String(str).getBytes("UTF-8"));
            var bytes = md.digest();
            var sb = new java.lang.StringBuilder();
            for (var i = 0; i < bytes.length; i++) {
                var tmp = java.lang.Integer.toHexString(bytes[i] & 0xFF);
                if (tmp.length() == 1) { sb.append("0"); }
                sb.append(tmp);
            }
            return sb.toString();
        } catch (e) { return ""; }
    }

    function getYoudaoInput(q) {
        if (q == null) return "";
        var len = q.length;
        if (len <= 20) { return q; }
        return q.substring(0, 10) + len + q.substring(len - 10, len);
    }
    
    function buildBaiduParams(q, fromLang, toLang) {
        var salt = java.util.UUID.randomUUID().toString();
        var signStr = API_APP_ID + q + salt + API_APP_SECRET;
        var sign = md5(signStr);
        return { q: q, from: fromLang, to: toLang, appid: API_APP_ID, salt: salt, sign: sign };
    }

    function buildYoudaoParams(q, fromLang, toLang) {
        var salt = java.util.UUID.randomUUID().toString();
        var curtime = String(Math.floor(Date.now() / 1000));
        var input = getYoudaoInput(q);
        var signStr = API_APP_ID + input + salt + curtime + API_APP_SECRET;
        var sign = sha256(signStr);
        return {
            q: q, from: fromLang, to: toLang, appKey: API_APP_ID, 
            salt: salt, sign: sign, signType: "v3", curtime: curtime
        };
    }
    
    function urlEncodeForm(params) {
        var pairs = [];
        var keys = [];
        for (var k in params) {
            if (Object.prototype.hasOwnProperty.call(params, k)) { keys.push(k); }
        }
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var v = params[k];
            if (v !== undefined && v !== null) {
                pairs.push(java.net.URLEncoder.encode(String(k), "UTF-8") + "=" + java.net.URLEncoder.encode(String(v), "UTF-8"));
            }
        }
        return pairs.join("&");
    }

    function setToArray(set) {
        var result = [];
        for (var key in set) {
            if (Object.prototype.hasOwnProperty.call(set, key) && set[key] === true) {
                result.push(parseInt(key, 10));
            }
        }
        return result.sort(function(a, b) { return a - b; });
    }
    
    function arrayIndexOf(arr, val) {
        for (var i = 0; i < arr.length; i++) {
            if (arr[i] === val) return i;
        }
        return -1;
    }
    
    var LONG_PRESS_TIME = 300;
    var TOUCH_SLOP = 12;

    var isDark = false;
    try {
        var uiMode = appContext.getResources().getConfiguration().uiMode;
        isDark = (uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK) === android.content.res.Configuration.UI_MODE_NIGHT_YES;
    } catch (e) {
        isDark = false;
    }

    var Colors = {
        bg: isDark ? Color.parseColor("#0f172a") : Color.parseColor("#ffffff"),
        surface: isDark ? Color.parseColor("#1e293b") : Color.parseColor("#f8fafc"),
        surfaceVariant: isDark ? Color.parseColor("#334155") : Color.parseColor("#f1f5f9"),
        text: isDark ? Color.parseColor("#f8fafc") : Color.parseColor("#0f172a"),
        textSecondary: isDark ? Color.parseColor("#94a3b8") : Color.parseColor("#64748b"),
        textTertiary: isDark ? Color.parseColor("#64748b") : Color.parseColor("#94a3b8"),
        primary: Color.parseColor("#6366f1"),
        primaryLight: isDark ? Color.parseColor("#312e81") : Color.parseColor("#e0e7ff"),
        onPrimary: Color.WHITE,
        selectionBg: Color.parseColor("#6366f1"),
        selectionText: Color.WHITE,
        selectionGlow: Color.parseColor("#818cf8"),
        success: Color.parseColor("#22c55e"),
        warning: Color.parseColor("#f59e0b"),
        btnPrimaryBg: Color.parseColor("#6366f1"),
        btnPrimaryPressed: Color.parseColor("#4f46e5"),
        btnSecondaryBg: isDark ? Color.parseColor("#334155") : Color.parseColor("#f1f5f9"),
        btnSecondaryPressed: isDark ? Color.parseColor("#475569") : Color.parseColor("#e2e8f0")
    };

    function dp(value) {
        return TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, appContext.getResources().getDisplayMetrics());
    }
    
    var screenWidth = 0;
    var screenHeight = 0;
    var isTablet = false;
    var windowWidth = 0;
    var maxWindowHeight = 0;
    var textAreaHeight = 0;
    var uiScale = 1.0;
    var screenCategory = "phone";

    function uiTextSize(phoneSp, tabletSp) {
        var base = isTablet ? tabletSp : phoneSp;
        return Math.max(9, Math.round(base * uiScale));
    }

    function uiDp(phoneDp, tabletDp) {
        var base = isTablet ? tabletDp : phoneDp;
        return dp(base * uiScale);
    }

    function getAdaptiveDefaultFontSize() {
        var adaptive = Math.round(DEFAULT_FONT_SIZE * uiScale);
        if (adaptive < MIN_FONT_SIZE) adaptive = MIN_FONT_SIZE;
        if (adaptive > MAX_FONT_SIZE) adaptive = MAX_FONT_SIZE;
        return adaptive;
    }
    
    function detectScreenSize() {
        try {
            var wm = appContext.getSystemService(appContext.WINDOW_SERVICE);
            var display = wm.getDefaultDisplay();
            var metrics = new android.util.DisplayMetrics();
            display.getMetrics(metrics);
            
            screenWidth = metrics.widthPixels;
            screenHeight = metrics.heightPixels;
            var widthDp = screenWidth / metrics.density;
            var heightDp = screenHeight / metrics.density;
            var smallestWidth = Math.min(widthDp, heightDp);
            var shortestPx = Math.min(screenWidth, screenHeight);
            isTablet = smallestWidth >= 600;

            if (isTablet) {
                if (smallestWidth >= 900) { screenCategory = "large_tablet"; uiScale = 1.28; } 
                else { screenCategory = "tablet"; uiScale = 1.16; }
            } else if (smallestWidth <= 360 || shortestPx <= 720) {
                screenCategory = "small_phone"; uiScale = 0.92;
            } else if (smallestWidth >= 480) {
                screenCategory = "large_phone"; uiScale = 1.08;
            } else {
                screenCategory = "phone"; uiScale = 1.0;
            }
            
            if (isTablet) {
                windowWidth = Math.min(screenWidth * 0.78, dp(smallestWidth >= 900 ? 920 : 760));
                maxWindowHeight = screenHeight * 0.85; 
                textAreaHeight = uiDp(DIY_CONFIG.TEXT_AREA_HEIGHT_DP, smallestWidth >= 900 ? DIY_CONFIG.TEXT_AREA_HEIGHT_DP + 100 : DIY_CONFIG.TEXT_AREA_HEIGHT_DP);
            } else if (screenCategory === "large_phone") {
                windowWidth = screenWidth * 0.88;
                maxWindowHeight = screenHeight * 0.85;
                textAreaHeight = uiDp(DIY_CONFIG.TEXT_AREA_HEIGHT_DP, DIY_CONFIG.TEXT_AREA_HEIGHT_DP);
            } else if (screenCategory === "small_phone") {
                windowWidth = screenWidth * 0.97;
                maxWindowHeight = screenHeight * 0.90;
                textAreaHeight = uiDp(DIY_CONFIG.TEXT_AREA_HEIGHT_DP - 50, DIY_CONFIG.TEXT_AREA_HEIGHT_DP - 50); 
            } else {
                windowWidth = screenWidth * 0.92;
                maxWindowHeight = screenHeight * 0.85;
                textAreaHeight = uiDp(DIY_CONFIG.TEXT_AREA_HEIGHT_DP, DIY_CONFIG.TEXT_AREA_HEIGHT_DP);
            }
        } catch (e) {
            screenCategory = "phone"; uiScale = 1.0;
            windowWidth = dp(360); maxWindowHeight = dp(600); textAreaHeight = dp(280);
        }
    }
    
    function createRoundRectDrawable(color, radiusDp) {
        var drawable = new GradientDrawable();
        drawable.setShape(GradientDrawable.RECTANGLE);
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        return drawable;
    }
    
    function createPressableDrawable(normalColor, pressedColor, radiusDp) {
        var StateListDrawable = android.graphics.drawable.StateListDrawable;
        var drawable = new StateListDrawable();
        var pressed = new GradientDrawable();
        pressed.setShape(GradientDrawable.RECTANGLE);
        pressed.setColor(pressedColor);
        pressed.setCornerRadius(dp(radiusDp));
        var normal = new GradientDrawable();
        normal.setShape(GradientDrawable.RECTANGLE);
        normal.setColor(normalColor);
        normal.setCornerRadius(dp(radiusDp));
        drawable.addState([android.R.attr.state_pressed], pressed);
        drawable.addState([], normal);
        return drawable;
    }
    
    function animateWindowEnter(view) {
        view.setScaleX(0.9); view.setScaleY(0.9); view.setAlpha(0);
        view.animate().scaleX(1).scaleY(1).alpha(1).setDuration(200)
            .setInterpolator(new android.view.animation.DecelerateInterpolator()).start();
    }
    
    function applyButtonAnimation(btn) {
        btn.setOnTouchListener(new View.OnTouchListener({
            onTouch: function(v, event) {
                switch(event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        v.animate().scaleX(0.95).scaleY(0.95).setDuration(80).start();
                        break;
                    case MotionEvent.ACTION_UP:
                    case MotionEvent.ACTION_CANCEL:
                        v.animate().scaleX(1).scaleY(1).setDuration(80).start();
                        break;
                }
                return false;
            }
        }));
    }
    
    function hapticFeedback(view) {
        try { view.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY); } catch (e) {}
    }

    function showToast(msg) {
        if (!mainHandler || !appContext) return;
        mainHandler.post(new java.lang.Runnable({
            run: function() {
                android.widget.Toast.makeText(appContext, String(msg), android.widget.Toast.LENGTH_SHORT).show();
            }
        }));
    }

    function setClipboard(text) {
        try {
            if (typeof setClip === 'function') {
                setClip(text);
                return true;
            } else {
                var cm = appContext.getSystemService(appContext.CLIPBOARD_SERVICE);
                if (cm) {
                    var clip = android.content.ClipData.newPlainText("拾字", String(text));
                    cm.setPrimaryClip(clip);
                    return true;
                }
            }
        } catch (e) {
            showToast("复制失败: " + e.message);
        }
        return false;
    }

    function runUi(action) {
        mainHandler.post(new java.lang.Runnable({ run: action }));
    }

    function getSharedPrefs() {
        return appContext.getSharedPreferences(PREFS_NAME, appContext.MODE_PRIVATE);
    }

    function getFontSizeStoreFile() {
        try {
            if (typeof shortx !== 'undefined' && shortx && shortx.getShortXDir) {
                return new java.io.File(shortx.getShortXDir() + "/data/pickword_font_size.txt");
            }
        } catch (e) {}
        return null;
    }

    function readFontSizeFromFile() {
        var file = getFontSizeStoreFile();
        if (!file || !file.exists()) return -1;
        try {
            var reader = new java.io.BufferedReader(new java.io.FileReader(file));
            var line = reader.readLine();
            reader.close();
            if (!line) return -1;
            var size = parseInt(String(line).replace(/\s+/g, ""), 10);
            return isNaN(size) ? -1 : size;
        } catch (e) {
            return -1;
        }
    }

    function writeFontSizeToFile(size) {
        var file = getFontSizeStoreFile();
        if (!file) return false;
        try {
            var parent = file.getParentFile();
            if (parent && !parent.exists()) { parent.mkdirs(); }
            var writer = new java.io.FileWriter(file, false);
            writer.write(String(size));
            writer.flush();
            writer.close();
            return true;
        } catch (e) {
            return false;
        }
    }

    function loadFontSize() {
        try {
            var defaultSize = getAdaptiveDefaultFontSize();
            var savedSize = readFontSizeFromFile();
            if (savedSize < 0) {
                try {
                    var prefs = getSharedPrefs();
                    savedSize = prefs.getInt(KEY_FONT_SIZE, -1);
                } catch (e1) { savedSize = -1; }
            }
            if (savedSize >= MIN_FONT_SIZE && savedSize <= MAX_FONT_SIZE) {
                currentFontSize = savedSize;
            } else {
                currentFontSize = defaultSize;
            }
        } catch (e) {
            currentFontSize = getAdaptiveDefaultFontSize();
        }
        return currentFontSize;
    }

    function saveFontSize(size) {
        var saved = writeFontSizeToFile(size);
        try {
            var prefs = getSharedPrefs();
            var editor = prefs.edit();
            editor.putInt(KEY_FONT_SIZE, size);
            editor.apply();
        } catch (e) {}
        return saved;
    }

    function rebuildSelectedSetFromIndices(indices) {
        var result = {};
        for (var i = 0; i < indices.length; i++) {
            result[indices[i]] = true;
        }
        return result;
    }
    
    var dragUpdateProcessor = new java.lang.Runnable({
        run: function() {
            pendingDragUpdate = null;
            selectedIndices = setToArray(selectedSet);
            拾字Floaty.updateSelectionSpans();
            拾字Floaty.updatePreview();
        }
    });

    var 拾字Floaty = {
        // 动态动画流参数
        currentScrollDirection: 0,
        currentScrollSpeed: 0,
        exactScrollY: 0, 

        show: function(text) {
            if (mainLayout !== null) {
                isShowing = true;
                this.resetTextLoadState((typeof text === 'string') ? text : String(text || ""));
                selectedIndices = [];
                selectedSet = {};
                addedSpans = []; 
                cachedLayout = null;
                pendingUpdate = false;
                isDragging = false;
                dragStartIndex = -1;
                lastDragIndex = -1;
                isLongPress = false;
                isAutoScrolling = false;
                lastTouchX = 0;
                lastTouchY = 0;
                lastTouchRawX = 0;
                lastTouchRawY = 0;
                fingerPreviewLastIndex = -1;
                fingerPreviewLastUpdateTime = 0;
                fingerPreviewMirrorContentDirty = false;
                fingerPreviewMirrorLastBindTime = 0;
                lastDragEnd = -1;
                lastTranslationState = null;
                this.currentScrollDirection = 0;
                this.currentScrollSpeed = 0;
                
                loadFontSize();
                var self = this;
                runUi(function() {
                    try {
                        if (seekBar) seekBar.setProgress(currentFontSize - MIN_FONT_SIZE);
                        if (fontSizeLabel) fontSizeLabel.setText(currentFontSize + "sp");
                        if (textView) textView.setTextSize(currentFontSize);
                        mainLayout.setVisibility(View.VISIBLE);
                        animateWindowEnter(mainLayout);
                        self.scheduleInitialTextLoad();
                    } catch (e) {
                        showToast("显示窗口失败: " + e.message);
                        isShowing = false;
                    }
                });
                return;
            }
            
            if (isShowing) {
                showToast("拾字已在运行");
                return;
            }
            
            loadFontSize();
            if (android.os.Build.VERSION.SDK_INT >= 23) {
                if (!android.provider.Settings.canDrawOverlays(appContext)) {
                    showToast("请先授予悬浮窗权限");
                    var intent = new android.content.Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
                    intent.setData(android.net.Uri.parse("package:" + appContext.getPackageName()));
                    intent.setFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                    appContext.startActivity(intent);
                    return;
                }
            }
            
            isShowing = true;
            this.resetTextLoadState((typeof text === 'string') ? text : String(text || ""));
            selectedIndices = [];
            selectedSet = {};
            addedSpans = []; 
            cachedLayout = null;
            pendingUpdate = false;
            isDragging = false;
            dragStartIndex = -1;
            lastDragIndex = -1;
            isLongPress = false;
            isAutoScrolling = false;
            lastTouchX = 0;
            lastTouchY = 0;
            lastTouchRawX = 0;
            lastTouchRawY = 0;
            fingerPreviewLastIndex = -1;
            fingerPreviewLastUpdateTime = 0;
            lastDragEnd = -1;
            lastTranslationState = null;
            this.currentScrollDirection = 0;
            this.currentScrollSpeed = 0;
            
            var self = this;
            runUi(function() {
                try {
                    self.createWindow();
                    animateWindowEnter(mainLayout);
                    self.scheduleInitialTextLoad();
                } catch (e) {
                    showToast("创建窗口失败: " + e.message);
                    isShowing = false;
                }
            });
        },
        
        hide: function() {
            if (windowManager !== null && mainLayout !== null) {
                runUi(function() {
                    try {
                        if (longPressHandler) {
                            mainHandler.removeCallbacks(longPressHandler);
                            longPressHandler = null;
                        }
                        if (autoScrollRunnable) {
                            mainHandler.removeCallbacks(autoScrollRunnable);
                            autoScrollRunnable = null;
                        }
                        if (keepAliveTimer) {
                            mainHandler.removeCallbacks(keepAliveTimer);
                            keepAliveTimer = null;
                        }
                        if (pendingFullTextRunnable) {
                            mainHandler.removeCallbacks(pendingFullTextRunnable);
                            pendingFullTextRunnable = null;
                        }
                        if (pendingFingerPreviewWarmupRunnable) {
                            mainHandler.removeCallbacks(pendingFingerPreviewWarmupRunnable);
                            pendingFingerPreviewWarmupRunnable = null;
                        }

                        拾字Floaty.removeFingerPreview();
                        
                        windowManager.removeView(mainLayout);
                        mainLayout = null;
                        textView = null;
                        scrollView = null;
                        previewTextView = null;
                        
                    } catch (e) {}
                    isShowing = false;
                });
            }
        },

        resetTextLoadState: function(text) {
            if (pendingFullTextRunnable) {
                try { mainHandler.removeCallbacks(pendingFullTextRunnable); } catch (e) {}
                pendingFullTextRunnable = null;
            }
            if (pendingFingerPreviewWarmupRunnable) {
                try { mainHandler.removeCallbacks(pendingFingerPreviewWarmupRunnable); } catch (e1) {}
                pendingFingerPreviewWarmupRunnable = null;
            }
            originalFullText = String(text || "");
            isPartialTextLoaded = false;
            fullText = originalFullText;
        },

        scheduleFingerPreviewWarmup: function(delayMs) {
            var self = this;
            if (pendingFingerPreviewWarmupRunnable) {
                try { mainHandler.removeCallbacks(pendingFingerPreviewWarmupRunnable); } catch (e0) {}
                pendingFingerPreviewWarmupRunnable = null;
            }
            pendingFingerPreviewWarmupRunnable = new java.lang.Runnable({
                run: function() {
                    pendingFingerPreviewWarmupRunnable = null;
                    try {
                        if (!isShowing || !mainLayout || !windowManager || fingerPreviewLayout) return;
                        self.createFingerPreview();
                    } catch (e1) {}
                }
            });
            mainHandler.postDelayed(pendingFingerPreviewWarmupRunnable, delayMs || 900);
        },

        loadFullTextNow: function(showMsg) {
            try {
                if (!isShowing || !textView || !isPartialTextLoaded) return false;
                if (isDragging || selectedIndices.length > 0) {
                    return false;
                }
                if (pendingFullTextRunnable) {
                    try { mainHandler.removeCallbacks(pendingFullTextRunnable); } catch (e0) {}
                    pendingFullTextRunnable = null;
                }
                fullText = String(originalFullText || fullText || "");
                isPartialTextLoaded = false;
                selectedIndices = [];
                selectedSet = {};
                addedSpans = [];
                cachedLayout = null;
                fingerPreviewMirrorReady = false;
                fingerPreviewMirrorContentDirty = true;
                this.updateTextView(true);
                this.updateActionButtons();
                this.adjustScrollViewHeight();
                if (showMsg) showToast("长文本已加载完整");
                return true;
            } catch (e1) {
                if (showMsg) showToast("加载全文失败: " + e1.message);
                return false;
            }
        },

        scheduleInitialTextLoad: function() {
            var self = this;
            if (pendingFullTextRunnable) {
                try { mainHandler.removeCallbacks(pendingFullTextRunnable); } catch (e0) {}
                pendingFullTextRunnable = null;
            }
            if (textView) {
                try {
                    textView.setText("正在加载文本…");
                    textView.setTextColor(Colors.textSecondary);
                } catch (e1) {}
            }
            mainHandler.postDelayed(new java.lang.Runnable({
                run: function() {
                    try {
                        if (!isShowing || !textView) return;
                        var source = String(originalFullText || fullText || "");
                        if (source.length > INITIAL_TEXT_FAST_LIMIT) {
                            isPartialTextLoaded = true;
                            fullText = source.substring(0, INITIAL_TEXT_FAST_LIMIT);
                            self.updateTextView(true);
                            self.updateActionButtons();
                            self.adjustScrollViewHeight();
                            self.scheduleFingerPreviewWarmup(900);

                            pendingFullTextRunnable = new java.lang.Runnable({
                                run: function() {
                                    try {
                                        if (!isShowing || !textView) return;
                                        if (isDragging || selectedIndices.length > 0) {
                                            mainHandler.postDelayed(pendingFullTextRunnable, 600);
                                            return;
                                        }
                                        self.loadFullTextNow(false);
                                    } catch (e2) {}
                                }
                            });
                            mainHandler.postDelayed(pendingFullTextRunnable, FULL_TEXT_DELAY_MS);
                        } else {
                            isPartialTextLoaded = false;
                            fullText = source;
                            self.updateTextView(true);
                            self.updateActionButtons();
                            self.adjustScrollViewHeight();
                            self.scheduleFingerPreviewWarmup(700);
                        }
                    } catch (e3) {
                        showToast("加载文本失败: " + e3.message);
                    }
                }
            }), INITIAL_TEXT_DELAY_MS);
        },
        
        createWindow: function() {
            detectScreenSize();
            windowManager = appContext.getSystemService(appContext.WINDOW_SERVICE);
            
            layoutParams = new LayoutParams(
                windowWidth, LayoutParams.WRAP_CONTENT,
                LayoutParams.TYPE_APPLICATION_OVERLAY,
                LayoutParams.FLAG_NOT_FOCUSABLE | LayoutParams.FLAG_DIM_BEHIND,
                android.graphics.PixelFormat.TRANSLUCENT
            );
            layoutParams.gravity = Gravity.CENTER | Gravity.TOP;
            layoutParams.x = 0;
            layoutParams.y = uiDp(56, 52);
            layoutParams.dimAmount = 0.4;
            
            mainLayout = new LinearLayout(appContext);
            mainLayout.setOrientation(LinearLayout.VERTICAL);
            mainLayout.setBackground(createRoundRectDrawable(Colors.bg, isTablet ? 20 : 16));
            mainLayout.setElevation(uiDp(6, 7));
            mainLayout.setPadding(uiDp(16, 24), uiDp(16, 20), uiDp(16, 24), uiDp(16, 20));
            
            var titleBar = this.createTitleBar();
            mainLayout.addView(titleBar);
            
            scrollView = new ScrollView(appContext);
            var scrollParams = new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, textAreaHeight);
            scrollParams.setMargins(0, uiDp(12, 14), 0, uiDp(8, 10));
            scrollView.setLayoutParams(scrollParams);
            
            textView = new TextView(appContext);
            textView.setTextColor(Colors.text);
            textView.setTextSize(currentFontSize);
            textView.setLineSpacing(uiDp(4, 6), 1.1);
            textView.setPadding(uiDp(12, 14), uiDp(12, 14), uiDp(12, 14), uiDp(12, 14));
            textView.setBackground(createRoundRectDrawable(Colors.surface, isTablet ? 12 : 8));
            textView.setClickable(false);
            textView.setLongClickable(false);
            textView.setFocusable(false);
            
            this.setupTextViewTouch();
            
            scrollView.addView(textView);
            mainLayout.addView(scrollView);
            
            var previewBox = this.createPreviewBox();
            mainLayout.addView(previewBox);
            
            var self = this;
            var actionBar = new LinearLayout(appContext);
            actionBar.setOrientation(LinearLayout.HORIZONTAL);
            actionBar.setPadding(0, uiDp(16, 20), 0, 0);
            
            copyActionBtn = this.createPrimaryBtn("📋 复制", function() { self.doCopy(); });
            translateActionBtn = this.createIconBtn("🌐 翻译", function() {
                if (lastTranslationState) { self.undoLastTranslation(); } else { self.doTranslate(); }
            });
            selectAllActionBtn = this.createIconBtn("全选", function() { self.selectAll(); });
            clearActionBtn = this.createIconBtn("清空", function() { self.clear(); });
            
            actionBar.addView(copyActionBtn);
            actionBar.addView(translateActionBtn);
            actionBar.addView(selectAllActionBtn);
            actionBar.addView(clearActionBtn);
            mainLayout.addView(actionBar);
            this.updateActionButtons();
            
            windowManager.addView(mainLayout, layoutParams);
        },
        
        createTitleBar: function() {
            var titleBar = new LinearLayout(appContext);
            titleBar.setOrientation(LinearLayout.HORIZONTAL);
            titleBar.setGravity(Gravity.CENTER_VERTICAL);
            var self = this;
            
            var normalMode = new LinearLayout(appContext);
            normalMode.setOrientation(LinearLayout.HORIZONTAL);
            normalMode.setGravity(Gravity.CENTER_VERTICAL);
            normalMode.setLayoutParams(new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
            
            var titleContainer = new LinearLayout(appContext);
            titleContainer.setOrientation(LinearLayout.HORIZONTAL);
            titleContainer.setGravity(Gravity.CENTER_VERTICAL);
            var iconText = new TextView(appContext);
            iconText.setText("✦"); iconText.setTextColor(Colors.primary); iconText.setTextSize(uiTextSize(18, 20));
            iconText.setPadding(0, 0, uiDp(6, 8), 0);
            var titleText = new TextView(appContext);
            titleText.setText("拾字"); titleText.setTextColor(Colors.text); titleText.setTextSize(uiTextSize(18, 20)); titleText.setTypeface(null, android.graphics.Typeface.BOLD);
            var blogText = new TextView(appContext);
            blogText.setText("阿然博客 xin-blog.com"); blogText.setTextColor(Colors.textTertiary); blogText.setTextSize(uiTextSize(9, 10));
            blogText.setOnClickListener(new View.OnClickListener({
                onClick: function(v) {
                    try { setClipboard("https://xin-blog.com"); showToast("链接已复制"); } catch (e) {}
                }
            }));
            var titleSubContainer = new LinearLayout(appContext);
            titleSubContainer.setOrientation(LinearLayout.VERTICAL);
            titleSubContainer.setGravity(Gravity.CENTER_VERTICAL);
            titleSubContainer.addView(titleText); titleSubContainer.addView(blogText);
            titleContainer.addView(iconText); titleContainer.addView(titleSubContainer);
            
            titleContainer.setLayoutParams(new LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
            
            var settingsBtn = new TextView(appContext);
            settingsBtn.setText("⚙"); settingsBtn.setTextColor(Colors.textSecondary); settingsBtn.setTextSize(uiTextSize(18, 20)); settingsBtn.setPadding(uiDp(12, 14), uiDp(8, 10), uiDp(12, 14), uiDp(8, 10));
            settingsBtn.setBackground(createPressableDrawable(Color.TRANSPARENT, isDark ? Color.parseColor("#334155") : Color.parseColor("#e2e8f0"), isTablet ? 16 : 12));
            var closeBtn = new TextView(appContext);
            closeBtn.setText("✕"); closeBtn.setTextColor(Colors.textSecondary); closeBtn.setTextSize(uiTextSize(16, 18));
            closeBtn.setPadding(uiDp(12, 14), uiDp(8, 10), uiDp(4, 8), uiDp(8, 10));
            closeBtn.setBackground(createPressableDrawable(Color.TRANSPARENT, isDark ? Color.parseColor("#334155") : Color.parseColor("#e2e8f0"), isTablet ? 16 : 12));
            settingsBtn.setOnClickListener(new View.OnClickListener({ onClick: function(v) { hapticFeedback(v); self.toggleFontSizePanel(); } }));
            applyButtonAnimation(settingsBtn);
            closeBtn.setOnClickListener(new View.OnClickListener({ onClick: function(v) { hapticFeedback(v); self.hide(); } }));
            applyButtonAnimation(closeBtn);
            normalMode.addView(titleContainer); normalMode.addView(settingsBtn); normalMode.addView(closeBtn);
            
            var settingMode = new LinearLayout(appContext);
            settingMode.setOrientation(LinearLayout.HORIZONTAL);
            settingMode.setGravity(Gravity.CENTER_VERTICAL);
            settingMode.setLayoutParams(new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
            settingMode.setVisibility(View.GONE);
            
            var smallA = new TextView(appContext); smallA.setText("A");
            smallA.setTextSize(uiTextSize(12, 13)); smallA.setTextColor(Colors.textSecondary); smallA.setPadding(0, 0, uiDp(8, 10), 0);
            seekBar = new SeekBar(appContext); seekBar.setLayoutParams(new LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
            seekBar.setMax(MAX_FONT_SIZE - MIN_FONT_SIZE);
            seekBar.setProgress(currentFontSize - MIN_FONT_SIZE);
            var largeA = new TextView(appContext); largeA.setText("A"); largeA.setTextSize(uiTextSize(18, 20)); largeA.setTextColor(Colors.textSecondary); largeA.setPadding(uiDp(8, 10), 0, 0, 0);
            fontSizeLabel = new TextView(appContext); fontSizeLabel.setText(currentFontSize + "sp"); fontSizeLabel.setTextColor(Colors.primary); fontSizeLabel.setTextSize(uiTextSize(12, 13)); fontSizeLabel.setPadding(uiDp(12, 14), 0, 0, 0);
            seekBar.setOnSeekBarChangeListener(new android.widget.SeekBar.OnSeekBarChangeListener({
                onProgressChanged: function(seekBar, progress, fromUser) { self.updateFontSize(MIN_FONT_SIZE + progress, true); },
                onStartTrackingTouch: function(seekBar) {},
                onStopTrackingTouch: function(seekBar) { var newSize = MIN_FONT_SIZE + seekBar.getProgress(); saveFontSize(newSize); self.updateFontSize(newSize); }
            }));
            var confirmBtn = new TextView(appContext); confirmBtn.setText("✓"); confirmBtn.setTextColor(Colors.success); confirmBtn.setTextSize(uiTextSize(16, 18)); confirmBtn.setPadding(uiDp(8, 10), uiDp(4, 6), uiDp(4, 6), uiDp(4, 6));
            confirmBtn.setBackground(createPressableDrawable(Color.TRANSPARENT, isDark ? Color.parseColor("#334155") : Color.parseColor("#e2e8f0"), isTablet ? 16 : 12));
            confirmBtn.setOnClickListener(new View.OnClickListener({ onClick: function(v) { hapticFeedback(v); self.toggleFontSizePanel(); } }));
            applyButtonAnimation(confirmBtn);
            
            settingMode.addView(smallA); settingMode.addView(seekBar); settingMode.addView(largeA); settingMode.addView(fontSizeLabel); settingMode.addView(confirmBtn);
            
            titleBar.addView(normalMode); titleBar.addView(settingMode);
            titleBarRefs.normalMode = normalMode; titleBarRefs.settingMode = settingMode;
            var touchStartX = 0, touchStartY = 0, layoutStartX = 0, layoutStartY = 0, isDraggingWindow = false;
            titleBar.setOnTouchListener(new View.OnTouchListener({
                onTouch: function(v, event) {
                    var action = event.getAction();
                    if (action === MotionEvent.ACTION_DOWN) {
                        touchStartX = event.getRawX(); touchStartY = event.getRawY(); layoutStartX = layoutParams.x; 
                        layoutStartY = layoutParams.y; isDraggingWindow = true; return true;
                    } else if (action === MotionEvent.ACTION_MOVE && isDraggingWindow) {
                        layoutParams.x = layoutStartX + (event.getRawX() - touchStartX); layoutParams.y = layoutStartY + (event.getRawY() - touchStartY);
                        windowManager.updateViewLayout(mainLayout, layoutParams); return true;
                    } else if (action === MotionEvent.ACTION_UP || action === MotionEvent.ACTION_CANCEL) {
                        isDraggingWindow = false; return true;
                    }
                    return false;
                }
            }));
            return titleBar;
        },
        
        toggleFontSizePanel: function() {
            if (!titleBarRefs.normalMode) return;
            var isSetting = titleBarRefs.settingMode.getVisibility() === View.VISIBLE;
            if (isSetting) {
                titleBarRefs.normalMode.setVisibility(View.VISIBLE);
                titleBarRefs.settingMode.setVisibility(View.GONE);
            } else {
                titleBarRefs.normalMode.setVisibility(View.GONE);
                titleBarRefs.settingMode.setVisibility(View.VISIBLE);
                seekBar.setProgress(currentFontSize - MIN_FONT_SIZE); fontSizeLabel.setText(currentFontSize + "sp");
            }
        },
        
        updateFontSize: function(size, skipAdjust) {
            currentFontSize = size;
            fingerPreviewMirrorReady = false;
            if (fontSizeLabel) fontSizeLabel.setText(size + "sp");
            if (textView) {
                textView.setTextSize(size);
                if (!skipAdjust) this.adjustScrollViewHeight();
            }
        },
        
        adjustScrollViewHeight: function() {
            if (!scrollView || !textView) return;
            if (pendingAdjustRunnable) { mainHandler.removeCallbacks(pendingAdjustRunnable); pendingAdjustRunnable = null; }
            pendingAdjustRunnable = new java.lang.Runnable({
                run: function() {
                    pendingAdjustRunnable = null;
                    try {
                        var layout = textView.getLayout();
                        if (layout) {
                            var lineCount = layout.getLineCount(); var lineHeight = textView.getLineHeight(); var padding = textView.getPaddingTop() + textView.getPaddingBottom();
                            var contentHeight = lineCount * lineHeight + padding;
                            var newHeight = Math.max(uiDp(60, 72), Math.min(contentHeight + uiDp(8, 10), textAreaHeight));
                            var params = scrollView.getLayoutParams();
                            if (params.height !== newHeight) { params.height = newHeight; scrollView.setLayoutParams(params); }
                        }
                    } catch (e) {}
                }
            });
            mainHandler.postDelayed(pendingAdjustRunnable, 50);
        },
        
        createPreviewBox: function() {
            var previewBox = new LinearLayout(appContext);
            previewBox.setOrientation(LinearLayout.VERTICAL); previewBox.setBackground(createRoundRectDrawable(Colors.primaryLight, isTablet ? 16 : 12));
            previewBox.setPadding(uiDp(12, 14), uiDp(10, 12), uiDp(12, 14), uiDp(10, 12));
            var params = new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT); params.setMargins(0, uiDp(12, 14), 0, 0); previewBox.setLayoutParams(params);
            
            var header = new LinearLayout(appContext); header.setOrientation(LinearLayout.HORIZONTAL);
            countLabelView = new TextView(appContext); countLabelView.setText("已选 0 字"); countLabelView.setTextColor(Colors.primary); countLabelView.setTextSize(uiTextSize(11, 12));
            countLabelView.setLayoutParams(new LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
            header.addView(countLabelView); previewBox.addView(header);
            var previewScroll = new ScrollView(appContext); previewScroll.setLayoutParams(new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, uiDp(60, 80)));
            previewTextView = new TextView(appContext); previewTextView.setText("点击选择文字..."); previewTextView.setTextColor(Colors.textSecondary); previewTextView.setTextSize(uiTextSize(14, 16)); previewTextView.setLineSpacing(uiDp(2, 4), 1);
            previewScroll.addView(previewTextView); previewBox.addView(previewScroll);
            return previewBox;
        },
        
        createPrimaryBtn: function(text, callback) {
            var btn = new Button(appContext);
            btn.setText(text); btn.setTextColor(Colors.onPrimary); btn.setTextSize(uiTextSize(14, 16)); btn.setBackground(createPressableDrawable(Colors.btnPrimaryBg, Colors.btnPrimaryPressed, isTablet ? 12 : 8)); btn.setAllCaps(false);
            var params = new LinearLayout.LayoutParams(0, uiDp(40, 48), 2);
            params.setMargins(uiDp(4, 6), 0, uiDp(4, 6), 0); btn.setLayoutParams(params);
            btn.setOnClickListener(new View.OnClickListener({ onClick: function(v) { hapticFeedback(v); try { callback(); } catch (e) { showToast("操作失败"); } } }));
            applyButtonAnimation(btn); return btn;
        },
        
        createIconBtn: function(text, callback) {
            var btn = new Button(appContext);
            btn.setText(text); btn.setTextColor(Colors.textSecondary); btn.setTextSize(uiTextSize(12, 14)); btn.setBackground(createPressableDrawable(Colors.btnSecondaryBg, Colors.btnSecondaryPressed, isTablet ? 12 : 8)); btn.setAllCaps(false);
            var params = new LinearLayout.LayoutParams(0, uiDp(40, 48), 1);
            params.setMargins(uiDp(4, 6), 0, uiDp(4, 6), 0); btn.setLayoutParams(params);
            btn.setOnClickListener(new View.OnClickListener({ onClick: function(v) { hapticFeedback(v); try { callback(); } catch (e) { showToast("操作失败"); } } }));
            applyButtonAnimation(btn); return btn;
        },
        
        createFingerPreview: function() {
            if (fingerPreviewLayout || !windowManager) return;
            try {
                if (screenWidth <= 0 || screenHeight <= 0) detectScreenSize();
                var size = Math.round(uiDp(FINGER_PREVIEW_SIZE_DP, FINGER_PREVIEW_SIZE_DP));
                if (size <= 0) return;

                // 关键优化：使用全屏透明悬浮容器，只移动内部圆形 View。
                // 这样拖动时不需要频繁调用 windowManager.updateViewLayout，明显减少卡顿。
                fingerPreviewLayout = new FrameLayout(appContext);
                fingerPreviewLayout.setPadding(0, 0, 0, 0);
                fingerPreviewLayout.setClipChildren(false);
                fingerPreviewLayout.setClipToPadding(false);
                fingerPreviewLayout.setBackgroundColor(Color.TRANSPARENT);
                try { fingerPreviewLayout.setLayerType(View.LAYER_TYPE_HARDWARE, null); } catch (layerErr0) {}

                fingerPreviewCircle = new FrameLayout(appContext);
                fingerPreviewCircle.setPadding(0, 0, 0, 0);
                fingerPreviewCircle.setClipChildren(true);
                fingerPreviewCircle.setClipToPadding(true);

                var plate = new GradientDrawable();
                plate.setShape(GradientDrawable.OVAL);
                plate.setColor(Colors.surface);
                plate.setStroke(Math.max(1, Math.round(dp(2))), Colors.primary);
                fingerPreviewCircle.setBackground(plate);
                try { fingerPreviewCircle.setElevation(uiDp(12, 14)); } catch (e1) {}
                try { fingerPreviewCircle.setLayerType(View.LAYER_TYPE_NONE, null); } catch (layerErr1) {}

                try {
                    if (android.os.Build.VERSION.SDK_INT >= 21) {
                        fingerPreviewCircle.setClipToOutline(true);
                    }
                } catch (outlineErr) {}

                fingerPreviewMirrorText = new TextView(appContext);
                fingerPreviewMirrorText.setGravity(Gravity.LEFT | Gravity.TOP);
                fingerPreviewMirrorText.setIncludeFontPadding(true);
                fingerPreviewMirrorText.setClickable(false);
                fingerPreviewMirrorText.setLongClickable(false);
                fingerPreviewMirrorText.setFocusable(false);
                fingerPreviewMirrorText.setBackground(createRoundRectDrawable(Colors.surface, isTablet ? 12 : 8));
                try { fingerPreviewMirrorText.setLayerType(View.LAYER_TYPE_NONE, null); } catch (layerErr2) {}

                fingerPreviewCircle.addView(
                    fingerPreviewMirrorText,
                    new FrameLayout.LayoutParams(size, size, Gravity.LEFT | Gravity.TOP)
                );

                var circleLp = new FrameLayout.LayoutParams(size, size, Gravity.LEFT | Gravity.TOP);
                fingerPreviewLayout.addView(fingerPreviewCircle, circleLp);

                var flags = LayoutParams.FLAG_NOT_FOCUSABLE |
                    LayoutParams.FLAG_NOT_TOUCHABLE |
                    LayoutParams.FLAG_LAYOUT_NO_LIMITS |
                    LayoutParams.FLAG_LAYOUT_IN_SCREEN;

                fingerPreviewParams = new LayoutParams(
                    LayoutParams.MATCH_PARENT,
                    LayoutParams.MATCH_PARENT,
                    LayoutParams.TYPE_APPLICATION_OVERLAY,
                    flags,
                    android.graphics.PixelFormat.TRANSLUCENT
                );
                fingerPreviewParams.gravity = Gravity.LEFT | Gravity.TOP;
                fingerPreviewParams.x = 0;
                fingerPreviewParams.y = 0;

                windowManager.addView(fingerPreviewLayout, fingerPreviewParams);
                fingerPreviewLayout.setAlpha(0);
                fingerPreviewLayout.setVisibility(View.VISIBLE);
            } catch (e) {
                fingerPreviewLayout = null;
                fingerPreviewCircle = null;
                fingerPreviewMirrorText = null;
                fingerPreviewParams = null;
                fingerPreviewMirrorReady = false;
                fingerPreviewMirrorContentDirty = false;
                fingerPreviewMirrorLastBindTime = 0;
                fingerPreviewMirrorSpans = [];
                if (!fingerPreviewCreateErrorShown) {
                    fingerPreviewCreateErrorShown = true;
                    showToast("放大镜创建失败: " + e.message);
                }
            }
        },

        syncFingerPreviewMirror: function(force) {
            if (!fingerPreviewMirrorText || !textView) return;
            if (fingerPreviewMirrorReady && !force) return;
            try {
                var size = Math.round(uiDp(FINGER_PREVIEW_SIZE_DP, FINGER_PREVIEW_SIZE_DP));
                var zoom = FINGER_PREVIEW_ZOOM;
                var sourceWidth = textView.getWidth();
                var sourceHeight = textView.getHeight();
                if (sourceWidth <= 0 || sourceHeight <= 0) return;

                var targetWidth = Math.max(size, Math.round(sourceWidth * zoom));
                var targetHeight = Math.max(size, Math.round(sourceHeight * zoom));
                var lp = fingerPreviewMirrorText.getLayoutParams();
                if (!lp || lp.width !== targetWidth || lp.height !== targetHeight) {
                    lp = new FrameLayout.LayoutParams(targetWidth, targetHeight, Gravity.LEFT | Gravity.TOP);
                    fingerPreviewMirrorText.setLayoutParams(lp);
                }

                fingerPreviewMirrorText.setTextColor(Colors.text);
                fingerPreviewMirrorText.setTextSize(currentFontSize * zoom);
                fingerPreviewMirrorText.setLineSpacing(uiDp(4, 6) * zoom, 1.1);
                fingerPreviewMirrorText.setPadding(
                    Math.round(textView.getPaddingLeft() * zoom),
                    Math.round(textView.getPaddingTop() * zoom),
                    Math.round(textView.getPaddingRight() * zoom),
                    Math.round(textView.getPaddingBottom() * zoom)
                );

                // 初始绑定独立的镜像 Spannable，后续只同步 Span，不再高频 setText。
                fingerPreviewMirrorSpans = [];
                fingerPreviewMirrorText.setText(new SpannableStringBuilder(String(fullText || "")), android.widget.TextView.BufferType.SPANNABLE);
                fingerPreviewMirrorReady = true;
                fingerPreviewMirrorContentDirty = false;
                fingerPreviewMirrorLastBindTime = Date.now();
                this.updateFingerPreviewMirrorSpans(true);
            } catch (e) {
                showToast("放大镜内容失败: " + e.message);
            }
        },

        markFingerPreviewContentDirty: function() {
            if (!fingerPreviewMirrorText) return;
            fingerPreviewMirrorContentDirty = true;
        },

        updateFingerPreviewMirrorSpans: function(force) {
            if (!fingerPreviewMirrorText) return;
            try {
                var liveText = fingerPreviewMirrorText.getText();
                var targetText = String(fullText || "");

                // 只有原文真正变化时才重绑文本；拖选过程中不再高频 setText。
                if (!liveText || typeof liveText.setSpan !== 'function' || String(liveText) !== targetText) {
                    fingerPreviewMirrorSpans = [];
                    fingerPreviewMirrorText.setText(new SpannableStringBuilder(targetText), android.widget.TextView.BufferType.SPANNABLE);
                    liveText = fingerPreviewMirrorText.getText();
                    if (!liveText || typeof liveText.setSpan !== 'function') return;
                }

                for (var mi = 0; mi < fingerPreviewMirrorSpans.length; mi++) {
                    try { liveText.removeSpan(fingerPreviewMirrorSpans[mi]); } catch (removeErr) {}
                }
                fingerPreviewMirrorSpans = [];

                if (selectedIndices.length > 0) {
                    var startIdx = selectedIndices[0];
                    var endIdx = startIdx;

                    for (var si = 1; si <= selectedIndices.length; si++) {
                        var currentIdx = selectedIndices[si];
                        if (si < selectedIndices.length && currentIdx === endIdx + 1) {
                            endIdx = currentIdx;
                        } else {
                            var bgSpan = new BackgroundColorSpan(Colors.selectionBg);
                            var fgSpan = new ForegroundColorSpan(Colors.selectionText);
                            liveText.setSpan(bgSpan, startIdx, endIdx + 1, android.text.Spannable.SPAN_EXCLUSIVE_EXCLUSIVE);
                            liveText.setSpan(fgSpan, startIdx, endIdx + 1, android.text.Spannable.SPAN_EXCLUSIVE_EXCLUSIVE);
                            fingerPreviewMirrorSpans.push(bgSpan);
                            fingerPreviewMirrorSpans.push(fgSpan);

                            if (si < selectedIndices.length) {
                                startIdx = currentIdx;
                                endIdx = currentIdx;
                            }
                        }
                    }
                }

                fingerPreviewMirrorContentDirty = false;
                fingerPreviewMirrorLastBindTime = Date.now();
                fingerPreviewMirrorText.invalidate();
                if (fingerPreviewCircle) fingerPreviewCircle.invalidate();
            } catch (e) {
                fingerPreviewMirrorContentDirty = true;
            }
        },

        syncFingerPreviewMirrorContent: function(force) {
            if (!fingerPreviewMirrorText || !textView) return;
            try {
                var now = Date.now();
                if (!force && !fingerPreviewMirrorContentDirty) return;
                if (!force && now - fingerPreviewMirrorLastBindTime < FINGER_PREVIEW_TEXT_REBIND_INTERVAL) return;
                this.updateFingerPreviewMirrorSpans(force);
            } catch (e) {}
        },

        showFingerPreview: function(rawX, rawY, index) {
            try {
                this.createFingerPreview();
                if (!fingerPreviewLayout || !fingerPreviewCircle) return;
                this.syncFingerPreviewMirror(true);
                this.updateFingerPreview(rawX, rawY, index, true);
                fingerPreviewLayout.setAlpha(1);
                fingerPreviewLayout.setVisibility(View.VISIBLE);
            } catch (e) {
                showToast("放大镜显示失败: " + e.message);
            }
        },

        updateFingerPreview: function(rawX, rawY, index, force) {
            if (!fingerPreviewLayout || !fingerPreviewCircle || !fingerPreviewMirrorText || !textView) return;
            try {
                var now = Date.now();
                if (!force && now - fingerPreviewLastUpdateTime < FINGER_PREVIEW_INTERVAL) return;
                fingerPreviewLastUpdateTime = now;

                var size = Math.round(uiDp(FINGER_PREVIEW_SIZE_DP, FINGER_PREVIEW_SIZE_DP));
                var offsetY = Math.round(uiDp(FINGER_PREVIEW_OFFSET_Y_DP, FINGER_PREVIEW_OFFSET_Y_DP));
                var x = Math.round(rawX - size / 2);
                var y = Math.round(rawY - offsetY);

                if (screenWidth <= 0 || screenHeight <= 0) detectScreenSize();
                if (x < 0) x = 0;
                if (screenWidth > size && x > screenWidth - size) x = Math.round(screenWidth - size);
                if (y < 0) y = 0;
                if (screenHeight > size && y > screenHeight - size) y = Math.round(screenHeight - size);

                // 只移动内部圆形 View，不更新悬浮窗 LayoutParams。
                if (force || Math.abs(x - fingerPreviewLastX) > FINGER_PREVIEW_MOVE_THRESHOLD_PX || Math.abs(y - fingerPreviewLastY) > FINGER_PREVIEW_MOVE_THRESHOLD_PX) {
                    fingerPreviewLastX = x;
                    fingerPreviewLastY = y;
                    fingerPreviewCircle.setTranslationX(x);
                    fingerPreviewCircle.setTranslationY(y);
                }

                this.updateFingerPreviewMirrorPosition(lastTouchX, lastTouchY);

                // 选区 Span 已由 updateSelectionSpans() 标记为 dirty，这里按 33ms 左右轻量重绑定一次。
                // 这样能同步选中背景，同时避免每个 MOVE 都 setText 造成卡顿。
                if (force || fingerPreviewMirrorContentDirty) {
                    this.syncFingerPreviewMirrorContent(force);
                }

                if (force || index !== fingerPreviewLastIndex || now - fingerPreviewLastContentUpdateTime >= FINGER_PREVIEW_CONTENT_INTERVAL) {
                    fingerPreviewLastIndex = index;
                    fingerPreviewLastContentUpdateTime = now;
                    // 位置变化由 translation 驱动，避免每帧强制 invalidate 整个圆形层。
                }

                if (fingerPreviewLayout.getAlpha() < 1) fingerPreviewLayout.setAlpha(1);
            } catch (e) {
                showToast("放大镜更新失败: " + e.message);
            }
        },

        updateFingerPreviewMirrorPosition: function(touchX, touchY) {
            if (!fingerPreviewMirrorText) return;
            try {
                var size = Math.round(uiDp(FINGER_PREVIEW_SIZE_DP, FINGER_PREVIEW_SIZE_DP));
                var radius = size / 2;
                var zoom = FINGER_PREVIEW_ZOOM;
                fingerPreviewMirrorText.setTranslationX(Math.round(radius - touchX * zoom));
                fingerPreviewMirrorText.setTranslationY(Math.round(radius - touchY * zoom));
            } catch (e) {}
        },

        hideFingerPreview: function() {
            fingerPreviewLastIndex = -1;
            fingerPreviewLastUpdateTime = 0;
            fingerPreviewLastContentUpdateTime = 0;
            fingerPreviewLastX = -9999;
            fingerPreviewLastY = -9999;
            fingerPreviewMirrorContentDirty = false;
            try {
                if (fingerPreviewLayout) {
                    fingerPreviewLayout.setAlpha(0);
                    fingerPreviewLayout.setVisibility(View.VISIBLE);
                }
            } catch (e) {}
        },

        removeFingerPreview: function() {
            try {
                if (fingerPreviewMirrorText) fingerPreviewMirrorText.setText("");
            } catch (e0) {}
            try {
                if (windowManager && fingerPreviewLayout) {
                    windowManager.removeView(fingerPreviewLayout);
                }
            } catch (e2) {}
            fingerPreviewLayout = null;
            fingerPreviewCircle = null;
            fingerPreviewMirrorText = null;
            fingerPreviewParams = null;
            fingerPreviewLastIndex = -1;
            fingerPreviewLastUpdateTime = 0;
            fingerPreviewLastContentUpdateTime = 0;
            fingerPreviewLastX = -9999;
            fingerPreviewLastY = -9999;
            fingerPreviewMirrorReady = false;
            fingerPreviewMirrorContentDirty = false;
            fingerPreviewMirrorLastBindTime = 0;
            fingerPreviewMirrorSpans = [];
            fingerPreviewCreateErrorShown = false;
        },

        setupTextViewTouch: function() {
            var self = this;
            var longPressRunnable = null;
            var isPressed = false;
            var lastValidIndex = -1;
            var onTouch = new View.OnTouchListener({
                onTouch: function(v, event) {
                    var action = event.getAction(); var x = event.getX(); var y = event.getY();
                    var rawX = event.getRawX(); var rawY = event.getRawY();
                    var currentIndex = self.getCharIndexAtPosition(x, y);
                  
                    switch(action) {
                        case MotionEvent.ACTION_DOWN:
                            isPressed = true; isDragging = false; dragStartIndex = -1; dragSnapshot = []; lastValidIndex = -1;
                            touchDownTime = Date.now(); touchDownX = x; touchDownY = y; touchDownRawX = rawX; touchDownRawY = rawY;
                            lastTouchX = x; lastTouchY = y; lastTouchRawX = rawX; lastTouchRawY = rawY;
                            if (scrollView) scrollView.requestDisallowInterceptTouchEvent(true);
                            if (longPressRunnable) mainHandler.removeCallbacks(longPressRunnable);
                            var textViewRef = textView;
                            longPressRunnable = new java.lang.Runnable({
                                run: function() {
                                    if (!isPressed || !textViewRef) return;
                                    var indexAtLongPress = self.getCharIndexAtPosition(touchDownX, touchDownY);
                                    if (indexAtLongPress < 0) {
                                        for (var offset = 10; offset <= 50; offset += 10) {
                                            if ((indexAtLongPress = self.getCharIndexAtPosition(touchDownX + offset, touchDownY)) >= 0) break;
                                            if ((indexAtLongPress = self.getCharIndexAtPosition(touchDownX - offset, touchDownY)) >= 0) break;
                                            if ((indexAtLongPress = self.getCharIndexAtPosition(touchDownX, touchDownY + offset)) >= 0) break;
                                            if ((indexAtLongPress = self.getCharIndexAtPosition(touchDownX, touchDownY - offset)) >= 0) break;
                                        }
                                    }
                                    if (indexAtLongPress < 0) return;
                                    isDragging = true; lastValidIndex = indexAtLongPress; dragStartIndex = indexAtLongPress; dragSnapshot = setToArray(selectedSet);
                                    cachedLayout = textViewRef.getLayout();
                                    try { textViewRef.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS);
                                    } catch (e) {}
                                    if (dragStartIndex >= 0) {
                                        if (selectedSet[dragStartIndex]) delete selectedSet[dragStartIndex];
                                        else selectedSet[dragStartIndex] = true;
                                        selectedIndices = setToArray(selectedSet); self.updateSelectionSpans(); self.updatePreview();
                                        self.showFingerPreview(touchDownRawX, touchDownRawY, dragStartIndex);
                                    }
                                }
                            });
                            longPressHandler = longPressRunnable;
                            mainHandler.postDelayed(longPressRunnable, LONG_PRESS_TIME);
                            return true;
                            
                        case MotionEvent.ACTION_MOVE:
                            if (!isPressed) return true;
                            lastTouchX = x; lastTouchY = y; lastTouchRawX = rawX; lastTouchRawY = rawY;
                            var moveIndex = self.getCharIndexAtPosition(x, y, isDragging);
                            if (moveIndex < 0 && isDragging) {
                                if (lastValidIndex >= 0) moveIndex = lastValidIndex;
                                if (moveIndex < 0) {
                                    for (var offset = 5; offset <= 40; offset += 5) {
                                        if ((moveIndex = self.getCharIndexAtPosition(x + offset, y, true)) >= 0) break;
                                        if ((moveIndex = self.getCharIndexAtPosition(x - offset, y, true)) >= 0) break;
                                        if ((moveIndex = self.getCharIndexAtPosition(x, y + offset, true)) >= 0) break;
                                        if ((moveIndex = self.getCharIndexAtPosition(x, y - offset, true)) >= 0) break;
                                    }
                                }
                            }
                            if (moveIndex >= 0) lastValidIndex = moveIndex;
                            var dx = Math.abs(x - touchDownX); var dy = Math.abs(y - touchDownY);
                            if (!isDragging && (dx > dp(TOUCH_SLOP) || dy > dp(TOUCH_SLOP))) {
                                if (longPressRunnable) { mainHandler.removeCallbacks(longPressRunnable);
                                longPressRunnable = null; longPressHandler = null; }
                                if (scrollView) scrollView.requestDisallowInterceptTouchEvent(false);
                            }
                            if (isDragging && moveIndex >= 0) { self.updateDragSelection(dragStartIndex, moveIndex, dragSnapshot);
                                self.updateFingerPreview(rawX, rawY, moveIndex, false);
                                self.checkAndScroll(x, y); }
                            return true;
                        case MotionEvent.ACTION_UP:
                        case MotionEvent.ACTION_CANCEL:
                            isPressed = false;
                            if (scrollView) scrollView.requestDisallowInterceptTouchEvent(false);
                            if (longPressRunnable) { mainHandler.removeCallbacks(longPressRunnable); longPressRunnable = null; longPressHandler = null;
                            }
                            
                            if (action === MotionEvent.ACTION_UP && !isDragging && (Date.now() - touchDownTime) < LONG_PRESS_TIME && Math.abs(x - touchDownX) < dp(TOUCH_SLOP) && Math.abs(y - touchDownY) < dp(TOUCH_SLOP)) {
                                if (currentIndex >= 0) self.toggleSelection(currentIndex);
                            }
                            
                            if (isDragging) {
                                if (pendingDragUpdate) { mainHandler.removeCallbacks(dragUpdateProcessor);
                                pendingDragUpdate = null; }
                                self.updatePreview();
                            }
                            self.stopAutoScroll();
                            self.hideFingerPreview();
                            isDragging = false; dragStartIndex = -1; dragSnapshot = []; lastValidIndex = -1; cachedLayout = null;
                            lastTouchX = 0; lastTouchY = 0; lastTouchRawX = 0; lastTouchRawY = 0;
                            lastDragEnd = -1; lastDragUpdateTime = 0;
                            return true;
                    }
                    return false;
                }
            });
            textView.setOnTouchListener(onTouch);
        },
        
        updateDragSelection: function(start, end, snapshot) {
            if (end === lastDragEnd) return;
            lastDragEnd = end;
            var currentMin = Math.min(start, end); var currentMax = Math.max(start, end); var startWasSelected = arrayIndexOf(snapshot, start) >= 0;
            selectedSet = {};
            for (var k = 0; k < snapshot.length; k++) { selectedSet[snapshot[k]] = true;
            }
            for (var i = currentMin; i <= currentMax; i++) {
                if (startWasSelected) delete selectedSet[i];
                else selectedSet[i] = true;
            }
            
            var now = Date.now();
            if (now - lastDragUpdateTime < DRAG_UPDATE_INTERVAL) {
                if (pendingDragUpdate) mainHandler.removeCallbacks(dragUpdateProcessor);
                pendingDragUpdate = true;
                mainHandler.postDelayed(dragUpdateProcessor, DRAG_UPDATE_INTERVAL);
            } else {
                lastDragUpdateTime = now;
                selectedIndices = setToArray(selectedSet); this.updateSelectionSpans(); this.updatePreview();
            }
        },
        
        checkAndScroll: function(touchX, touchY) {
            if (!scrollView || !isDragging || !textView) { this.stopAutoScroll();
                return; }
            lastTouchX = touchX;
            lastTouchY = touchY;
            var relativeY = touchY + textView.getTop() - scrollView.getScrollY();
            var scrollViewHeight = scrollView.getHeight();
            var topZone = scrollViewHeight * SCROLL_EDGE_TOP;
            var bottomZone = scrollViewHeight * (1 - SCROLL_EDGE_BOTTOM);
            
            var newDirection = 0; var newSpeed = 0;
            if (relativeY < topZone) {
                newDirection = -1;
                newSpeed = SCROLL_MIN_SPEED + (SCROLL_MAX_SPEED - SCROLL_MIN_SPEED) * ((topZone - relativeY) / topZone);
            } else if (relativeY > bottomZone) {
                newDirection = 1;
                newSpeed = SCROLL_MIN_SPEED + (SCROLL_MAX_SPEED - SCROLL_MIN_SPEED) * ((relativeY - bottomZone) / (scrollViewHeight - bottomZone));
            }
            
            this.currentScrollDirection = newDirection;
            this.currentScrollSpeed = newSpeed;

            if (newDirection !== 0) {
                this.startAutoScroll();
            } else {
                this.stopAutoScroll();
            }
        },
        
        startAutoScroll: function() {
            if (isAutoScrolling) return; 
            isAutoScrolling = true;
            this.exactScrollY = scrollView.getScrollY(); 
            
            var self = this;
            autoScrollRunnable = new java.lang.Runnable({
                run: function() {
                    if (!isDragging || !isAutoScrolling || !scrollView || self.currentScrollDirection === 0) { 
                        isAutoScrolling = false; return; 
                    }
                    
                    var maxScroll = Math.max(0, textView.getHeight() - scrollView.getHeight());
                    
                    // 完美的浮点累加滚动像素，适配不同的手机帧率
                    var step = dp(self.currentScrollSpeed) * 0.4; 
                    
                    if (self.currentScrollDirection < 0) {
                        self.exactScrollY -= step;
                    } else {
                        self.exactScrollY += step;
                    }
                    
                    if (self.exactScrollY < 0) self.exactScrollY = 0;
                    if (self.exactScrollY > maxScroll) self.exactScrollY = maxScroll;
                    
                    var newIntY = Math.round(self.exactScrollY);
                    var currentIntY = scrollView.getScrollY();
                    
                    if (newIntY !== currentIntY) {
                        scrollView.scrollTo(0, newIntY);
                        var moveIndex = self.getCharIndexAtPosition(lastTouchX, lastTouchY, true);
                        if (moveIndex >= 0 && dragStartIndex >= 0) {
                            self.updateDragSelection(dragStartIndex, moveIndex, dragSnapshot);
                            self.updateFingerPreview(lastTouchRawX, lastTouchRawY, moveIndex, false);
                        }
                    }
                    
                    if (self.exactScrollY > 0 && self.exactScrollY < maxScroll) {
                        mainHandler.postDelayed(autoScrollRunnable, DIY_CONFIG.SCROLL_DELAY_MS);
                    } else {
                        isAutoScrolling = false;
                    }
                }
            });
            mainHandler.postDelayed(autoScrollRunnable, DIY_CONFIG.SCROLL_DELAY_MS);
        },
        
        stopAutoScroll: function() {
            isAutoScrolling = false;
            this.currentScrollDirection = 0;
            if (autoScrollRunnable) { 
                mainHandler.removeCallbacks(autoScrollRunnable); 
                autoScrollRunnable = null; 
            }
        },
        
        getCharIndexAtPosition: function(x, y, useCachedLayout) {
            if (!textView || !fullText || fullText.length === 0) return -1;
            try {
                var layout = useCachedLayout && cachedLayout ?
                cachedLayout : textView.getLayout();
                if (!layout) return -1;
                x -= textView.getPaddingLeft(); y -= textView.getPaddingTop();
                var lineCount = layout.getLineCount();
                var layoutHeight = layout.getHeight();
                
                if (y < -dp(20) || y > layoutHeight + dp(20)) return -1;
                if (y < 0) y = 0; if (y > layoutHeight) y = layoutHeight - 1;
                
                var line = layout.getLineForVertical(y);
                if (line < 0) line = 0; if (line >= lineCount) line = lineCount - 1;
                var lineStart = layout.getLineStart(line);
                var lineEnd = layout.getLineEnd(line);
                
                var offset = layout.getOffsetForHorizontal(line, x);
                if (offset < lineStart) offset = lineStart;
                if (offset >= lineEnd) offset = Math.max(0, lineEnd - 1);
                if (offset < 0) offset = 0;
                if (offset >= fullText.length) offset = fullText.length - 1;
                return offset;
            } catch (e) { return -1;
            }
        },
        
        toggleSelection: function(index) {
            if (textView) hapticFeedback(textView);
            if (selectedSet[index]) this.removeFromSelection(index); else this.addToSelection(index);
        },
        
        addToSelection: function(index) {
            if (index < 0 || index >= fullText.length || selectedSet[index]) return;
            selectedSet[index] = true; selectedIndices = setToArray(selectedSet); this.updateSelectionSpans(); this.updatePreview();
        },
        
        removeFromSelection: function(index) {
            if (index < 0 || index >= fullText.length || !selectedSet[index]) return;
            delete selectedSet[index]; selectedIndices = setToArray(selectedSet); this.updateSelectionSpans(); this.updatePreview();
        },
        
        // 【核心绝杀修复】直接提取屏幕上正在显示的 liveText，直接修改颜色，免去全量测算的排版地狱！
        updateSelectionSpans: function() {
            if (!textView) return;
            try {
                // 直接抓取 TextView 里当前正在显示的文本对象！
                var liveText = textView.getText();
                if (!liveText || typeof liveText.setSpan !== 'function') return;

                // 擦除旧颜色
                for (var i = 0; i < addedSpans.length; i++) {
                    liveText.removeSpan(addedSpans[i]);
                }
                addedSpans = [];

                if (selectedIndices.length > 0) {
                    var startIdx = selectedIndices[0];
                    var endIdx = startIdx;

                    for (var i = 1; i <= selectedIndices.length; i++) {
                        var currentIdx = selectedIndices[i];
                        if (i < selectedIndices.length && currentIdx === endIdx + 1) {
                            endIdx = currentIdx;
                        } else {
                            var bgSpan = new BackgroundColorSpan(Colors.selectionBg);
                            var fgSpan = new ForegroundColorSpan(Colors.selectionText);
                            
                            // 直接向当前正在显示的 Live 文本里注入颜色标签
                            liveText.setSpan(bgSpan, startIdx, endIdx + 1, android.text.Spannable.SPAN_EXCLUSIVE_EXCLUSIVE);
                            liveText.setSpan(fgSpan, startIdx, endIdx + 1, android.text.Spannable.SPAN_EXCLUSIVE_EXCLUSIVE);
                            
                            addedSpans.push(bgSpan);
                            addedSpans.push(fgSpan);
                            if (i < selectedIndices.length) {
                                startIdx = currentIdx;
                                endIdx = currentIdx;
                            }
                        }
                    }
                }
                // 【绝杀】不排版，但强制命令安卓系统立即重绘界面颜色（耗时 <0.1ms），背景色瞬间显现且绝对丝滑！
                textView.invalidate();
                if (fingerPreviewMirrorText && fingerPreviewMirrorReady) {
                    this.updateFingerPreviewMirrorSpans(false);
                } else {
                    this.markFingerPreviewContentDirty();
                }
                
            } catch (e) {}
        },
        
        updateTextView: function(skipAdjust) {
            addedSpans = [];
            fingerPreviewMirrorReady = false;
            fingerPreviewMirrorContentDirty = true;
            fingerPreviewMirrorLastBindTime = 0;
            fingerPreviewMirrorSpans = [];
            spannable = new SpannableStringBuilder(fullText);
            // 必须指定 BufferType.SPANNABLE，才能让后续用 liveText 直接修改颜色生效
            textView.setTextColor(Colors.text);
            textView.setText(spannable, android.widget.TextView.BufferType.SPANNABLE); 
            this.updatePreview(); 
            if (!skipAdjust) this.adjustScrollViewHeight();
        },

        getSelectedText: function() {
            if (selectedIndices.length === 0) return "";
            var chars = []; for (var i = 0; i < selectedIndices.length; i++) { chars.push(fullText.charAt(selectedIndices[i]));
            }
            return chars.join('');
        },

        setActionEnabled: function(view, enabled) {
            if (!view) return;
            try { view.setEnabled(enabled); view.setAlpha(enabled ? 1.0 : 0.45); } catch (e) {}
        },

        updateActionButtons: function() {
            var hasSelection = selectedIndices.length > 0;
            var hasUndo = !!lastTranslationState;
            if (translateActionBtn) translateActionBtn.setText(hasUndo ? "↶ 撤销" : "🌐 翻译");
            this.setActionEnabled(copyActionBtn, hasSelection); this.setActionEnabled(translateActionBtn, hasSelection || hasUndo);
            this.setActionEnabled(selectAllActionBtn, fullText && fullText.length > 0); this.setActionEnabled(clearActionBtn, hasSelection);
        },

        replaceSelectedText: function(newText) {
            if (selectedIndices.length === 0) return false;
            var replacement = String(newText == null ? "" : newText); var oldText = fullText; var oldSelected = selectedIndices.slice(0);
            var removeMap = rebuildSelectedSetFromIndices(oldSelected); var firstIndex = oldSelected[0]; var parts = []; var inserted = false;
            for (var i = 0; i < oldText.length; i++) {
                if (removeMap[i]) { if (!inserted) { parts.push(replacement);
                inserted = true; } } else { parts.push(oldText.charAt(i)); }
            }
            if (!inserted) parts.push(replacement);
            lastTranslationState = { fullText: oldText, selectedIndices: oldSelected };
            fullText = parts.join(''); selectedIndices = []; selectedSet = {};
            for (var j = 0; j < replacement.length; j++) { selectedIndices.push(firstIndex + j); selectedSet[firstIndex + j] = true;
            }

            var self = this;
            runUi(function() { try { self.updateTextView(); self.updateSelectionSpans(); self.adjustScrollViewHeight(); self.updateActionButtons(); } catch (e) { showToast("替换失败"); } });
            return true;
        },

        undoLastTranslation: function() {
            if (!lastTranslationState) { showToast("没有可撤销内容");
            return; }
            fullText = lastTranslationState.fullText; selectedIndices = lastTranslationState.selectedIndices.slice(0);
            selectedSet = rebuildSelectedSetFromIndices(selectedIndices); lastTranslationState = null;
            var self = this;
            runUi(function() { try { self.updateTextView(); self.updateSelectionSpans(); self.adjustScrollViewHeight(); self.updateActionButtons(); showToast("已撤销"); } catch (e) {} });
        },
        
        updatePreview: function() {
            var count = selectedIndices.length;
            if (countLabelView) countLabelView.setText("已选 " + count + " 字");
            this.updateActionButtons();
            if (count === 0) {
                if (isPartialTextLoaded) previewTextView.setText("长文本自动加载中，先显示前" + fullText.length + "字...");
                else previewTextView.setText("点击选择文字...");
                previewTextView.setTextColor(Colors.textSecondary); return;
            }
            
            var chars = [];
            for (var i = 0; i < selectedIndices.length; i++) { chars.push(fullText.charAt(selectedIndices[i]));
            }
            previewTextView.setText(chars.join('')); previewTextView.setTextColor(Colors.text);
        },
        
        selectAll: function() {
            selectedSet = {};
            selectedIndices = [];
            for (var i = 0; i < fullText.length; i++) { selectedSet[i] = true; selectedIndices.push(i);
            }
            this.updateSelectionSpans(); this.updatePreview();
            showToast("已全选 " + selectedIndices.length + " 个字");
        },
        
        clear: function() {
            selectedIndices = [];
            selectedSet = {}; this.updateSelectionSpans(); this.updatePreview();
        },
        
        isChinese: function(text) {
            for (var i = 0; i < text.length; i++) {
                var code = text.charCodeAt(i);
                if (code >= 0x4E00 && code <= 0x9FA5) return true;
            }
            return false;
        },
        
        doTranslate: function() {
            try {
                if (selectedIndices.length === 0) { showToast("请先选择文字");
                return; }
                if (!API_APP_ID || !API_APP_SECRET) { showToast("请先配置翻译接口的 APPID 和 秘钥");
                return; }
                var text = this.getSelectedText();
                if (text.length > 5000) { showToast("文本过长，最多支持5000字符"); return; }
                
                if (isTranslating) { showToast("正在翻译中，请稍候...");
                return; }
                
                isTranslating = true;
                showToast("正在翻译...");
                var self = this;
                
                new java.lang.Thread(new java.lang.Runnable({
                    run: function() {
                        try {
                          
                            var apiType = DIY_CONFIG.TRANSLATE_API;
                            var isCh = self.isChinese(text);
                            var source = "auto";
                            var target = "";
  
                            var params = null;
                            var reqUrl = "";
                            
                            if (apiType === 2) {
                                target = isCh ? "en" : "zh-CHS";
                                params = buildYoudaoParams(text, source, target);
                                reqUrl = YD_API_URL;
                            } else {
                                target = isCh ? "en" : "zh";
                                params = buildBaiduParams(text, source, target);
                                reqUrl = BD_API_URL;
                            }
                            
                            var formBody = urlEncodeForm(params);
                            var url = new java.net.URL(reqUrl); 
                            var conn = url.openConnection();
                            
                            conn.setRequestMethod("POST"); 
                            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded"); 
                            conn.setDoOutput(true); 
                            conn.setConnectTimeout(10000); 
                            conn.setReadTimeout(30000);
                            
                            var os = conn.getOutputStream();
                            os.write(new java.lang.String(formBody).getBytes("UTF-8")); 
                            os.flush(); 
                            os.close();
                            
                            var responseCode = conn.getResponseCode(); 
                            var inputStream = responseCode === 200 ? conn.getInputStream() : conn.getErrorStream();
                            var reader = new java.io.BufferedReader(new java.io.InputStreamReader(inputStream, "UTF-8"));
                            var line; var response = "";
                            while ((line = reader.readLine()) != null) { response += line;
                            } 
                            reader.close();
                            if (responseCode !== 200) { showToast("翻译失败: HTTP " + responseCode); return;
                            }
                            
                            var json = JSON.parse(response);
                            var translatedText = "";
                            
                            if (apiType === 2) {
                                if (json.errorCode && json.errorCode !== "0") { showToast("翻译失败: 错误码 " + json.errorCode); return;
                                }
                                if (json.translation && json.translation.length > 0) {
                                    translatedText = json.translation[0];
                                }
                            } else {
                                if (json.error_code !== undefined && 
                                    json.error_code != 0) { showToast("翻译失败: 错误码 " + json.error_code); return;
                                }
                                if (json.trans_result && json.trans_result.length > 0) {
                                    var parts = [];
                                    for (var ti = 0; ti < json.trans_result.length; ti++) { parts.push(json.trans_result[ti].dst);
                                    }
                                    translatedText = parts.join("\n");
                                }
                            }
                            
                            if (translatedText) { 
             
                                self.replaceSelectedText(translatedText);
                                showToast("翻译并替换完成"); 
                            } else { 
                                showToast("翻译失败: 无效响应");
                            }
                        } catch (e) { 
                            showToast("翻译出错: " + e.message);
                        } finally {
                            isTranslating = false;
                        }
                    }
                })).start();
            } catch (e) { 
                isTranslating = false;
                showToast("翻译启动失败: " + e.message); 
            }
        },
        
        doCopy: function() {
            if (selectedIndices.length === 0) { showToast("请先选择文字");
            return; }
            var chars = [];
            for (var i = 0; i < selectedIndices.length; i++) { chars.push(fullText.charAt(selectedIndices[i]));
            }
            var text = chars.join(''); setClipboard(text); showToast("已复制"); this.hide();
        }
    };

    function startBigBang(text) {
        try {
            if (typeof text === 'function') text = text();
            if (typeof text !== 'string') text = String(text || "");
            if (!text || text.length === 0) {
                var cm = appContext.getSystemService(appContext.CLIPBOARD_SERVICE);
                if (cm && cm.hasPrimaryClip() && cm.getPrimaryClip() && cm.getPrimaryClip().getItemCount() > 0) {
                    var item = cm.getPrimaryClip().getItemAt(0);
                    text = item.getText() ? item.getText().toString() : "";
                }
            }
            if (!text || text.length === 0) { showToast("剪贴板为空");
            return; }
            
            if (text.length > DIY_CONFIG.MAX_CHAR_LIMIT) { 
                text = text.substring(0, DIY_CONFIG.MAX_CHAR_LIMIT);
                showToast("文本过长，已截取前" + DIY_CONFIG.MAX_CHAR_LIMIT + "字"); 
            }
            
            拾字Floaty.show(text);
            if (keepAliveTimer) mainHandler.removeCallbacks(keepAliveTimer);
            keepAliveTimer = new java.lang.Runnable({
                run: function() { if (isShowing && keepAliveTimer) mainHandler.postDelayed(keepAliveTimer, 5000); }
            });
            mainHandler.postDelayed(keepAliveTimer, 5000);
            
        } catch (e) { showToast("启动失败: " + e.message);
        }
    }

    try {
        var events = require('events');
        events.on("exit", function() {
            if (windowManager !== null) {
                try { 拾字Floaty.removeFingerPreview(); } catch (e1) {}
                if (mainLayout !== null) {
                    try { windowManager.removeView(mainLayout); } catch (e2) {}
                }
            }
        });
    } catch(e) { }

    var closeBigBang = function() {
        try { 拾字Floaty.hide();
        return true; } catch (e) { return false; }
    };
    var inputText = typeof localVarOf$剪贴板 !== 'undefined' ? localVarOf$剪贴板 : null;
    startBigBang(inputText);
    
})();
