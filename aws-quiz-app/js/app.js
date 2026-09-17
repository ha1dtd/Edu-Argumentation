let currentQuestionIndex = 0;
let score = 0;
let isAnswered = false;
let selectedAnswer = null;      // the option picked on the current question, so a resumed quiz shows it
let activeQuizData = [];
let quizData = [];
let tutorialData = {};
let generatedQuizData = null;
// Which slice of the bank activeQuizData currently holds. Identity checks
// (activeQuizData === quizData) cannot tell a block slice from the whole bank,
// because a slice is a new array, so the nav would light up "AI quiz".
// 'module' = the whole bank | 'block' = the block you are reading | 'ai' = model-written
let quizScope = 'module';
let quizScopeLabel = '';
// Which block a block-scoped quiz belongs to, captured when the quiz starts.
// Read at the finish, so navigating the reader afterwards cannot credit the
// wrong block.
let quizScopeBlockId = null;
// Server-held study progress: { completed: { 'ch01-b03': {at, score, total, source} } }
// Kept on the server, not in localStorage, so it survives a cache clear and
// follows the reader to another device.
let progress = { completed: {} };
// Progress belongs to a MODULE. Block ids are positional, so every book has a
// ch01-b03; without this, a second book's first lesson would show Géron's tick.
// Explicit id first, never the title: the Géron title changes when chapters are
// merged in, and a title-derived key would orphan every completion.
let moduleId = '';

function moduleIdFor(parsedData) {
    const explicit = String(parsedData.moduleId || (parsedData.tutorialData || {}).moduleId || '').trim().toLowerCase();
    if (/^[a-z0-9][a-z0-9-]{1,63}$/.test(explicit)) return explicit;
    const slug = String((parsedData.tutorialData || {}).title || 'module').toLowerCase()
        .normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56);
    return /^[a-z0-9]/.test(slug) && slug.length >= 2 ? `t-${slug}` : 'module';
}

const BUNDLED_MODULE_URL = 'data/geron_hands_on_ml_ch01_ch09.json';
let GENERATED_QUIZ_SIZE = 20;   // overridden by server general settings
let aiQuestionCount = 5;        // overridden by server general settings
const MAX_FRESH_QUIZ_SIZE = 30; // server enforces the same cap
// Declared up here, not beside the AI section: setAppState reads providerReady,
// and a `let` read above its declaration is a boot-killing TDZ error.
let providerReady = false;
let providerTokenRequired = true;
let providerModel = '';

const dom = {
    appContainer: document.getElementById('app-container'),
    landingDashboard: document.getElementById('landing-dashboard'),
    contentSection: document.getElementById('content-section'),
    servicesSection: document.getElementById('services-section'),
    
    emptyState: document.getElementById('empty-state'),
    welcomeScreen: document.getElementById('welcome-screen'),
    loadingScreen: document.getElementById('loading-screen'),
    loadingModel: document.getElementById('loading-model'),
    loadingScope: document.getElementById('loading-scope'),
    
    tutorialScreen: document.getElementById('tutorial-screen'),
    quizScreen: document.getElementById('quiz-screen'),
    quizSetupScreen: document.getElementById('quiz-setup-screen'),
    setupTitle: document.getElementById('setup-title'),
    setupTree: document.getElementById('setup-tree'),
    setupAllBtn: document.getElementById('setup-all-btn'),
    setupNoneBtn: document.getElementById('setup-none-btn'),
    setupCount: document.getElementById('setup-count'),
    setupStartBtn: document.getElementById('setup-start-btn'),
    setupResumeBtn: document.getElementById('setup-resume-btn'),
    resultScreen: document.getElementById('result-screen'),
    
    appSubTitle: document.getElementById('app-sub-title'),
    welcomeTitle: document.getElementById('welcome-title'),
    
    startBtn: document.getElementById('start-btn'),
    readTutorialBtn: document.getElementById('read-tutorial-btn'),
    tutorialToQuizBtn: document.getElementById('tutorial-to-quiz-btn'),
    navTutorial: document.getElementById('nav-tutorial'),
    brandHome: document.getElementById('brand-home'),
    navQuiz: document.getElementById('nav-quiz'),
    navGeneratedQuiz: document.getElementById('nav-generated-quiz'),
    navLearn: document.getElementById('nav-learn'),
    navSettings: document.getElementById('nav-settings'),
    primaryNav: document.getElementById('primary-nav'),
    menuBtn: document.getElementById('menu-btn'),
    settingsScreen: document.getElementById('settings-screen'),
    settingsForm: document.getElementById('settings-form'),
    adminToken: document.getElementById('admin-token'),
    settingsUnlockBtn: document.getElementById('settings-unlock-btn'),
    settingsLockStatus: document.getElementById('settings-lock-status'),
    settingsLockCard: document.getElementById('settings-lock-card'),
    settingsSaveBtn: document.getElementById('settings-save-btn'),
    settingsStatus: document.getElementById('settings-status'),
    setApiUrl: document.getElementById('set-api-url'),
    setApiKey: document.getElementById('set-api-key'),
    setModel: document.getElementById('set-model'),
    setJsonMode: document.getElementById('set-json-mode'),
    setAccessToken: document.getElementById('set-access-token'),
    setRequireToken: document.getElementById('set-require-token'),
    setAiCount: document.getElementById('set-ai-count'),
    setFreshSize: document.getElementById('set-fresh-size'),
    apiKeyState: document.getElementById('api-key-state'),
    accessTokenState: document.getElementById('access-token-state'),
    startGeneratedBtn: document.getElementById('start-generated-btn'),
    customDataUpload: document.getElementById('custom-data-upload'),
    
    tutorialContent: document.getElementById('tutorial-content'),
    tutorialTitle: document.getElementById('tutorial-main-title'),
    tutorialLead: document.getElementById('tutorial-lead'),
    tocNav: document.getElementById('toc-nav'),
    tocPanel: document.getElementById('toc-panel'),
    tocBackdrop: document.getElementById('toc-backdrop'),
    tocToggleBtn: document.getElementById('toc-toggle-btn'),
    tocCloseBtn: document.getElementById('toc-close-btn'),
    tocSummary: document.getElementById('toc-summary'),
    theoryChapterLabel: document.getElementById('theory-chapter-label'),
    theoryBlockPosition: document.getElementById('theory-block-position'),
    prevBlockBtn: document.getElementById('prev-block-btn'),
    nextBlockBtn: document.getElementById('next-block-btn'),
    blockAiQuizBtn: document.getElementById('block-ai-quiz-btn'),
    aiBlockStatus: document.getElementById('ai-block-status'),
    tutorialToQuizLabel: document.getElementById('tutorial-to-quiz-label'),
    quizScopeLabel: document.getElementById('quiz-scope-label'),
    
    questionText: document.getElementById('question-text'),
    questionAsset: document.getElementById('question-asset'),
    optionsContainer: document.getElementById('options-container'),
    questionNumberBadge: document.getElementById('question-number-badge'),
    scoreTracker: document.getElementById('score-tracker'),
    
    actionContainer: document.getElementById('action-container'),
    nextBtn: document.getElementById('next-btn'),
    nextBtnText: document.getElementById('next-btn-text'),
    retakeBtnHeader: document.getElementById('retake-btn-header'),
    quizNewBtn: document.getElementById('quiz-new-btn'),
    resultNewBtn: document.getElementById('result-new-btn'),
    
    finalScore: document.getElementById('final-score'),
    finalFraction: document.getElementById('final-fraction'),
    resultMessage: document.getElementById('result-message'),
    restartBtn: document.getElementById('restart-btn'),
    generateNewBtn: document.getElementById('generate-new-btn'),
    resultBackBtn: document.getElementById('result-back-btn'),
    resultBackLabel: document.getElementById('result-back-label'),
    resultNextBtn: document.getElementById('result-next-btn'),
    resultNextLabel: document.getElementById('result-next-label'),
    
    progressContainer: document.getElementById('progress-container'),
    progressBar: document.getElementById('progress-bar')
};

const templates = {
    tutorialSection: document.getElementById('tmpl-tutorial-section'),
    tutorialListItem: document.getElementById('tmpl-tutorial-list-item'),
    quizOption: document.getElementById('tmpl-quiz-option')
};

// --- Header menu ----------------------------------------------------------
// Below md the nav is a dropdown; at md+ it is an inline row and always shown.
const MENU_WIDE = '(min-width: 768px)';
let menuOpen = false;

function isWideMenu() { return window.matchMedia(MENU_WIDE).matches; }

function setMenuOpen(open) {
    menuOpen = open;
    dom.primaryNav.classList.toggle('hidden-view', !open);
    if (dom.menuBtn) dom.menuBtn.setAttribute('aria-expanded', String(open));
}

function syncMenuToViewport() { setMenuOpen(isWideMenu()); }

function showSettings() {
    dom.landingDashboard.classList.add('hidden-view');
    dom.contentSection.classList.remove('hidden-view');
    dom.tutorialScreen.classList.add('hidden-view');
    dom.quizScreen.classList.add('hidden-view');
    dom.resultScreen.classList.add('hidden-view');
    dom.quizSetupScreen.classList.add('hidden-view');
    dom.progressContainer.classList.add('hidden-view');
    dom.settingsScreen.classList.remove('hidden-view');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    updateNavUI('settings');
    loadSettings();
}

// --- Contents panel -------------------------------------------------------
// Below lg the panel is a fixed overlay drawer, so it never pushes the theory
// down the page; at lg+ it is a static column the reader can collapse to give
// the text the full width.
const WIDE_VIEWPORT = '(min-width: 1024px)';
let tocOpen = false;

function isWideViewport() {
    return window.matchMedia(WIDE_VIEWPORT).matches;
}

function setTocOpen(open) {
    tocOpen = open;
    dom.tocPanel.classList.toggle('hidden-view', !open);
    // The backdrop carries lg:hidden, so it stays out of the desktop layout.
    dom.tocBackdrop.classList.toggle('hidden-view', !open);
    if (dom.tocToggleBtn) dom.tocToggleBtn.setAttribute('aria-expanded', String(open));
}

function syncTocToViewport() {
    // Open by default where there is room for it, closed where there is not.
    setTocOpen(isWideViewport());
}


function setAppState(isReady, moduleName = null) {
    if (dom.appSubTitle && dom.welcomeTitle) {
        if (moduleName) {
            dom.appSubTitle.textContent = "Active Module: " + moduleName;
            dom.welcomeTitle.textContent = moduleName;
        } else {
            dom.appSubTitle.textContent = "Education is the movement from darkness to light";
        }
    }
    
    if (!isReady) {
        dom.emptyState.classList.remove('hidden-view');
        dom.welcomeScreen.classList.add('hidden-view');
    } else {
        dom.emptyState.classList.add('hidden-view');
        dom.welcomeScreen.classList.remove('hidden-view');
    }
    
    const controls = [dom.readTutorialBtn, dom.startBtn];
    controls.forEach(btn => {
        if (!btn) return;
        btn.disabled = !isReady;
    });
    // A fresh quiz is written by the connected model, so it also needs a provider.
    if (dom.startGeneratedBtn) dom.startGeneratedBtn.disabled = !isReady || !providerReady;
}

// Nav items are a dropdown below md and a row at md+, so the base class string
// carries both layouts. Rewriting className here would otherwise wipe the
// responsive classes and leave the mobile menu unstyled.
const NAV_BASE_CLASS = 'min-h-[44px] px-3 md:px-0 text-left md:text-center rounded-lg md:rounded-none pb-0 md:pb-1 border-b-2 border-transparent text-gray-400 transition-colors hover:text-white';

function updateNavUI(activeTab) {
    const tabs = {
        tutorial: dom.navTutorial,
        learn: dom.navLearn,
        quiz: dom.navQuiz,
        'generated-quiz': dom.navGeneratedQuiz,
        settings: dom.navSettings,
    };
    Object.values(tabs).forEach(el => { if (el) el.className = NAV_BASE_CLASS; });
    const activeEl = tabs[activeTab] || dom.navQuiz;
    activeEl.classList.remove('border-transparent', 'text-gray-400');
    activeEl.classList.add('border-brand-500', 'text-white');
}

function showLandingDashboard() {
    dom.contentSection.classList.add('hidden-view');
    dom.landingDashboard.classList.remove('hidden-view');
    dom.servicesSection.classList.remove('hidden-view');
    dom.settingsScreen.classList.add('hidden-view');
    dom.loadingScreen.classList.add('hidden-view');
    
    if(tutorialData.title) {
        dom.emptyState.classList.add('hidden-view');
        dom.welcomeScreen.classList.remove('hidden-view');
    } else {
        dom.emptyState.classList.remove('hidden-view');
        dom.welcomeScreen.classList.add('hidden-view');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    updateNavUI('tutorial');
}

function showTutorial() {
    if (!tutorialData.title) return;
    dom.landingDashboard.classList.add('hidden-view');
    dom.contentSection.classList.remove('hidden-view');
    
    dom.tutorialScreen.classList.remove('hidden-view');
    dom.settingsScreen.classList.add('hidden-view');
    dom.quizScreen.classList.add('hidden-view');
    dom.resultScreen.classList.add('hidden-view');
    dom.quizSetupScreen.classList.add('hidden-view');

    window.scrollTo({ top: 0, behavior: 'smooth' });
    // 'learn', not 'tutorial': the 'tutorial' key belongs to nav-tutorial, which
    // is the HOME button since the nav was relabelled. Passing it here left the
    // underline stuck on HOME while the reader was open.
    updateNavUI('learn');
}

function showQuizScreen() {
    dom.landingDashboard.classList.add('hidden-view');
    dom.contentSection.classList.remove('hidden-view');
    
    dom.tutorialScreen.classList.add('hidden-view');
    dom.settingsScreen.classList.add('hidden-view');
    dom.resultScreen.classList.add('hidden-view');
    dom.quizSetupScreen.classList.add('hidden-view');
    dom.quizScreen.classList.remove('hidden-view');
    
    dom.progressContainer.classList.remove('hidden-view');
    dom.scoreTracker.textContent = score;
    updateNavUI(navTabForScope());
    renderQuizScope();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function startQuiz() {
    if (!tutorialData.title) return;
    showQuizScreen();
    if (!isAnswered && activeQuizData.length > 0) {
        loadQuestion();
    } else if (activeQuizData.length === 0) {
        showResults();
    }
    saveQuizSession();
}

function showResults() {
    dom.landingDashboard.classList.add('hidden-view');
    dom.contentSection.classList.remove('hidden-view');
    
    dom.tutorialScreen.classList.add('hidden-view');
    dom.settingsScreen.classList.add('hidden-view');
    dom.quizScreen.classList.add('hidden-view');
    dom.quizSetupScreen.classList.add('hidden-view');
    dom.resultScreen.classList.remove('hidden-view');
    dom.progressContainer.classList.add('hidden-view');

    const totalQuestions = activeQuizData.length;
    const percent = totalQuestions === 0 ? 0 : Math.round((score / totalQuestions) * 100);
    
    dom.finalFraction.textContent = `${score} / ${totalQuestions}`;
    
    dom.resultMessage.innerHTML = '';
    if (quizScope === 'ai') {
        dom.generateNewBtn.classList.remove('hidden-view');
    } else {
        dom.generateNewBtn.classList.add('hidden-view');
    }
    
    const spanMsg = document.createElement('span');
    spanMsg.className = 'font-light block mb-4 text-3xl text-white';
    
    if (totalQuestions === 0) {
        spanMsg.textContent = 'No Assessment Available.';
        spanMsg.classList.add('text-gray-400');
        dom.resultMessage.appendChild(spanMsg);
    } else if (percent >= 80) {
        spanMsg.textContent = 'Outstanding Performance!';
        spanMsg.classList.add('text-emerald-400');
        dom.resultMessage.appendChild(spanMsg);
        dom.resultMessage.appendChild(document.createTextNode(' You have demonstrated expert-level mastery of the material.'));
    } else if (percent >= 60) {
        spanMsg.textContent = 'Solid Effort.';
        spanMsg.classList.add('text-brand-400');
        dom.resultMessage.appendChild(spanMsg);
        dom.resultMessage.appendChild(document.createTextNode(' You understand the fundamentals well, but reviewing key concepts will push you further.'));
    } else {
        spanMsg.textContent = 'Keep Reviewing.';
        spanMsg.classList.add('text-brand-500');
        dom.resultMessage.appendChild(spanMsg);
        dom.resultMessage.appendChild(document.createTextNode(' Review the tutorial material deeply before retaking the assessment.'));
    }

    if (quizScopeBlockId && totalQuestions > 0 && score < totalQuestions && !progress.completed[quizScopeBlockId]) {
        const rule = document.createElement('span');
        rule.className = 'block mt-6 text-sm text-gray-400';
        rule.textContent = `Not complete yet \u2014 a block needs 100% (you got ${score}/${totalQuestions}). Retake to finish it.`;
        dom.resultMessage.appendChild(rule);
    }

    // Before the 0% early return below -- a zero score is exactly when the reader
    // most needs a way back to the block.
    renderResultNav(score, totalQuestions);

    if (percent === 0) {
        dom.finalScore.textContent = `0%`;
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }

    let currentPercent = 0;
    const animationDuration = 1000;
    const intervalTime = animationDuration / percent;
    
    const interval = setInterval(() => {
        currentPercent++;
        dom.finalScore.textContent = `${currentPercent}%`;
        if (currentPercent >= percent) {
            clearInterval(interval);
            dom.finalScore.textContent = `${percent}%`;
        }
    }, intervalTime);
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --- Result screen navigation ----------------------------------------------
const RESULT_BTN_BASE = 'min-h-[44px] max-w-full font-bold uppercase tracking-wider py-4 px-8 transition-colors rounded-lg border-2';
const RESULT_BTN_PRIMARY = 'bg-brand-600 hover:bg-brand-900 border-brand-600 text-white';
const RESULT_BTN_SECONDARY = 'bg-transparent border-gray-500 text-gray-300 hover:bg-gray-700 hover:text-white hover:border-gray-400';

function blockFromId(blockId) {
    const match = /^ch(\d{2})-b(\d{2})$/.exec(blockId || '');
    if (!match) return null;
    return clampTheory({ chapterIndex: Number(match[1]) - 1, blockIndex: Number(match[2]) - 1 });
}

function styleResultButton(button, primary, order) {
    if (!button) return;
    const hidden = button.classList.contains('hidden-view');
    button.className = `${RESULT_BTN_BASE} ${primary ? RESULT_BTN_PRIMARY : RESULT_BTN_SECONDARY}`;
    if (hidden) button.classList.add('hidden-view');
    // Visual order only; on a phone the column stacks, so the lead action is on top.
    button.style.order = String(order);
}

// Pass a block and the way forward leads. Miss it and the way back leads --
// but Next stays available, because moving on is the reader's call, not ours.
function renderResultNav(scored, totalQuestions) {
    const origin = blockFromId(quizScopeBlockId);
    const passed = totalQuestions > 0 && scored === totalQuestions;
    const next = origin ? nextTheory(origin) : null;

    if (dom.resultBackLabel) dom.resultBackLabel.textContent = origin ? 'Back to block' : 'Back to reading';

    if (dom.resultNextBtn) {
        dom.resultNextBtn.classList.toggle('hidden-view', !next);
        if (next && dom.resultNextLabel) {
            const block = theoryBlocks(next.chapterIndex)[next.blockIndex];
            const sameChapter = next.chapterIndex === origin.chapterIndex;
            const name = (block && block.term) || `Block ${next.blockIndex + 1}`;
            dom.resultNextLabel.textContent = sameChapter
                ? `Next: ${name} \u2192`
                : `Next chapter: ${name} \u2192`;
            dom.resultNextBtn.title = name;
        }
    }

    // An AI quiz launched from a block regenerates for THAT block, not the book.
    if (dom.generateNewBtn) {
        dom.generateNewBtn.textContent = origin ? 'Another AI quiz on this block' : 'Generate Another Quiz';
    }

    const forward = Boolean(origin && passed && next);
    styleResultButton(dom.resultNextBtn, forward, forward ? 0 : 3);
    styleResultButton(dom.resultBackBtn, !forward && Boolean(origin), forward ? 1 : 0);
    styleResultButton(dom.restartBtn, false, 2);
    styleResultButton(dom.resultNewBtn, false, 4);
    styleResultButton(dom.generateNewBtn, !origin && quizScope === 'ai', 2);
}

function returnToReader(selection) {
    if (selection) selectTheory(selection);
    showTutorial();
}

function showResultsViewOnly() {
    showResults();
    updateNavUI(navTabForScope());
    renderQuizScope();
}

function restartQuiz() {
    currentQuestionIndex = 0;
    score = 0;
    isAnswered = false;
    startQuiz();
}

// --- Quiz sessions ------------------------------------------------------------
// PRACTICE and GENERATE QUIZ each keep their own quiz -- questions, position, score,
// the answer just picked -- until a new one is started (user, 17-09-26: "whenever I
// move to other screen and back they reset ... they should stay until I press new").
// Quizzes launched from the reader are 'reader' quizzes and never overwrite a tab's.
const quizSessions = { practice: null, generate: null };
let quizOrigin = 'tab';

function sessionKey() {
    return quizScope === 'ai' ? 'generate' : 'practice';
}

function sessionStoreKey() {
    return `eduQuizSessions.${moduleId || 'module'}`;
}

function saveQuizSession() {
    if (quizOrigin !== 'tab' || !activeQuizData.length) return;
    quizSessions[sessionKey()] = {
        questions: activeQuizData, quizScope, quizScopeBlockId, quizScopeLabel,
        currentQuestionIndex, score, isAnswered, selectedAnswer,
        aiFromSetup, lastGenerateSelection,
    };
    try {
        const out = {};
        Object.entries(quizSessions).forEach(([key, session]) => {
            if (!session) return;
            // The written bank is already loaded, so a practice quiz is stored as question ids.
            out[key] = { ...session, questions: key === 'practice'
                ? session.questions.map(q => q && q.source && q.source.question) : session.questions };
        });
        localStorage.setItem(sessionStoreKey(), JSON.stringify(out));
    } catch (error) { /* per-viewer convenience; the in-page session still holds */ }
}

function loadQuizSessions() {
    quizSessions.practice = null;
    quizSessions.generate = null;
    try {
        const saved = JSON.parse(localStorage.getItem(sessionStoreKey()) || '{}');
        const byId = new Map(quizData.map(q => [q && q.source && q.source.question, q]));
        ['practice', 'generate'].forEach(key => {
            const session = saved[key];
            if (!session || !Array.isArray(session.questions) || !session.questions.length) return;
            const questions = key === 'practice' ? session.questions.map(id => byId.get(id)) : session.questions;
            // The bank changed under a stored quiz: drop it rather than show broken questions.
            if (questions.some(q => !q || !Array.isArray(q.options))) return;
            quizSessions[key] = { ...session, questions };
        });
    } catch (error) { /* nothing stored, or storage blocked */ }
}

function sessionFinished(session) {
    return session.currentQuestionIndex >= session.questions.length;
}

function resumeQuizSession(key) {
    const session = quizSessions[key];
    if (!session || !tutorialData.title) return false;
    activeQuizData = session.questions;
    quizScope = session.quizScope;
    quizScopeBlockId = session.quizScopeBlockId;
    quizScopeLabel = session.quizScopeLabel;
    currentQuestionIndex = session.currentQuestionIndex;
    score = session.score;
    aiFromSetup = Boolean(session.aiFromSetup);
    lastGenerateSelection = session.lastGenerateSelection || [];
    quizOrigin = 'tab';
    if (quizScope === 'ai') generatedQuizData = activeQuizData;
    if (sessionFinished(session)) {
        isAnswered = false;
        showResultsViewOnly();
        return true;
    }
    showQuizScreen();
    loadQuestion();
    if (session.isAnswered && Number.isInteger(session.selectedAnswer)) {
        const cards = dom.optionsContainer.querySelectorAll('.option-card');
        if (cards[session.selectedAnswer]) handleAnswerSelect(session.selectedAnswer, cards[session.selectedAnswer], true);
    }
    return true;
}

// A tab goes back to its own quiz; only with none does it open the picker.
function openQuizTab(mode) {
    if (!tutorialData.title) return;
    if (!resumeQuizSession(mode)) openQuizSetup(mode);
}

// --- Quiz scope -------------------------------------------------------------
// One place decides what activeQuizData holds and what the header calls it, so
// the nav highlight and the scope caption can never disagree with the data.
function setModuleQuiz() {
    activeQuizData = quizData;
    quizScope = 'module';
    quizScopeBlockId = null;
    quizScopeLabel = tutorialData.title || 'Whole module';
    currentQuestionIndex = 0;
    score = 0;
    isAnswered = false;
}

function setBlockQuiz(questions, chapterIndex = currentTheory.chapterIndex, blockIndex = currentTheory.blockIndex) {
    activeQuizData = questions;
    quizScope = 'block';
    quizScopeBlockId = theoryBlockId(chapterIndex, blockIndex);
    const chapter = theoryChapters()[chapterIndex];
    const blocks = theoryBlocks(chapterIndex);
    const block = blocks[blockIndex];
    const chapterName = (chapter && chapter.title) || `Chapter ${chapterIndex + 1}`;
    const blockName = (block && block.term) || `Block ${blockIndex + 1}`;
    quizScopeLabel = `${chapterName} — ${blockName}`;
    currentQuestionIndex = 0;
    score = 0;
    isAnswered = false;
}

// Any mix of blocks from the written bank. No single block owns it, so no block is
// marked complete by it.
function setSelectionQuiz(questions, label) {
    activeQuizData = questions;
    quizScope = 'selection';
    quizScopeBlockId = null;
    quizScopeLabel = label;
    currentQuestionIndex = 0;
    score = 0;
    isAnswered = false;
}

function setAiQuiz(questions, blockId = null) {
    activeQuizData = questions;
    generatedQuizData = questions;
    quizScope = 'ai';
    quizScopeBlockId = blockId;
    currentQuestionIndex = 0;
    score = 0;
    isAnswered = false;
}

// --- Study progress ---------------------------------------------------------
// A block is complete when an assessment SCOPED TO IT is answered perfectly.
// Chapter percentage is completed blocks / blocks in that chapter, which is what
// the reader asked for: 1 of 10 reads 10%.

async function refreshProgress() {
    try {
        const response = await fetch(`api/progress?module=${encodeURIComponent(moduleId)}`);
        if (!response.ok) return;
        const data = await response.json();
        if (data && typeof data.completed === 'object' && data.completed) progress = data;
    } catch (error) {
        // Offline or the endpoint is missing: the reader still reads, the
        // percentages just stay at zero. Never block the page on progress.
    }
    renderTheoryToc();
    renderTheoryBlock();
}

function isBlockComplete(chapterIndex, blockIndex) {
    return Boolean(progress.completed[theoryBlockId(chapterIndex, blockIndex)]);
}

function chapterProgress(chapterIndex) {
    const total = theoryBlocks(chapterIndex).length;
    if (!total) return { done: 0, total: 0, percent: 0 };
    let done = 0;
    for (let i = 0; i < total; i += 1) if (isBlockComplete(chapterIndex, i)) done += 1;
    return { done, total, percent: Math.round((done / total) * 100) };
}

function overallProgress() {
    let done = 0, total = 0;
    theoryChapters().forEach((_chapter, index) => {
        const p = chapterProgress(index);
        done += p.done;
        total += p.total;
    });
    return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

function announceCompletion(blockId) {
    const match = /^ch(\d{2})-b(\d{2})$/.exec(blockId);
    if (!match || !dom.resultMessage) return;
    const chapterIndex = Number(match[1]) - 1;
    const chapter = theoryChapters()[chapterIndex];
    const p = chapterProgress(chapterIndex);
    const note = document.createElement('span');
    note.className = 'block mt-6 text-base font-semibold text-green-400';
    const name = (chapter && chapter.title) || `Chapter ${chapterIndex + 1}`;
    note.textContent = `✓ Block complete — ${name} is now ${p.percent}% (${p.done} of ${p.total}).`;
    dom.resultMessage.appendChild(note);
}

// Called ONLY when a quiz is actually finished, never when results are re-opened
// for viewing -- otherwise re-reading an old result would re-post it.
async function recordQuizResult() {
    const blockId = quizScopeBlockId;
    const total = activeQuizData.length;
    if (!blockId || total === 0) return;
    try {
        const response = await fetch('api/progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ module: moduleId, block: blockId, score, total, source: quizScope === 'ai' ? 'ai' : 'written' })
        });
        if (!response.ok) return;
        const data = await response.json();
        if (data && data.completed) progress = { completed: data.completed };
        if (data && data.marked) announceCompletion(blockId);
    } catch (error) {
        // A failed write must not eat the result screen. The reader sees their
        // score; the block simply is not ticked, and retaking will re-post.
    }
    renderTheoryToc();
}

// The nav tab a given scope belongs under. A block slice is still the written
// bank, so it lights up "Quiz", not "AI quiz".
function navTabForScope() {
    return quizScope === 'ai' ? 'generated-quiz' : 'quiz';
}

function renderQuizScope() {
    if (!dom.quizScopeLabel) return;
    if (quizScope === 'module') {
        dom.quizScopeLabel.textContent = `Whole module · ${activeQuizData.length} questions`;
    } else if (quizScope === 'block' || quizScope === 'selection') {
        dom.quizScopeLabel.textContent = `${quizScopeLabel} · ${activeQuizData.length} question${activeQuizData.length === 1 ? '' : 's'}`;
    } else {
        dom.quizScopeLabel.textContent = `AI-written · ${activeQuizData.length} questions`;
    }
}

dom.navTutorial.addEventListener('click', showLandingDashboard); 
dom.brandHome.addEventListener('click', () => { showLandingDashboard(); if (!isWideMenu()) setMenuOpen(false); });

// Landing card and PRACTICE tab: pick a chapter and block first (user, 17-09-26).
// The in-reader Begin Assessment button stays the one-click scoped quiz.
dom.startBtn.addEventListener('click', () => openQuizTab('practice'));
dom.readTutorialBtn.addEventListener('click', showTutorial);
dom.prevBlockBtn.addEventListener('click', () => { const target = previousTheory(); if (target) selectTheory(target); });
dom.nextBlockBtn.addEventListener('click', () => { const target = nextTheory(); if (target) selectTheory(target); });
dom.blockAiQuizBtn.addEventListener('click', startBlockAiQuiz);
dom.tocToggleBtn.addEventListener('click', () => setTocOpen(!tocOpen));
dom.tocCloseBtn.addEventListener('click', () => setTocOpen(false));
dom.tocBackdrop.addEventListener('click', () => setTocOpen(false));
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && tocOpen && !isWideViewport()) setTocOpen(false);
});
window.matchMedia(WIDE_VIEWPORT).addEventListener('change', syncTocToViewport);
document.addEventListener('DOMContentLoaded', syncTocToViewport);
window.addEventListener('hashchange', () => {
    if (!theoryChapters().length) return;
    selectTheory(theoryFromHash());
});
// THE FIX: assess the block you are actually reading, not all 9 chapters.
// Blocks with no pre-written question fall through to the AI generator rather
// than dead-ending on a disabled button.
dom.tutorialToQuizBtn.addEventListener('click', () => {
    const scoped = currentBlockQuiz();
    if (!scoped.length) {
        if (providerReady) { startBlockAiQuiz(); }
        else { setAiBlockStatus('No written questions for this block, and no model is connected to write any. Connect one in Settings.'); }
        return;
    }
    setBlockQuiz(scoped);
    quizOrigin = 'reader';
    startQuiz();
});

dom.nextBtn.addEventListener('click', () => {
    currentQuestionIndex++;
    if (currentQuestionIndex < activeQuizData.length) {
        loadQuestion();
    } else {
        // The one genuine finish. showResults() is also reached by re-opening an
        // old result, which must not re-record anything.
        recordQuizResult();
        showResults();
    }
    saveQuizSession();
});

dom.retakeBtnHeader.addEventListener('click', restartQuiz);
// New opens the picker; the current quiz stays saved until the picker's Start replaces it.
dom.quizNewBtn.addEventListener('click', () => openQuizSetup(sessionKey()));
dom.resultNewBtn.addEventListener('click', () => openQuizSetup(sessionKey()));
dom.restartBtn.addEventListener('click', restartQuiz);

dom.startGeneratedBtn.addEventListener('click', () => openQuizTab('generate'));
dom.generateNewBtn.addEventListener('click', () => {
    // A quiz picked on the setup screen regenerates the SAME pick, block or not.
    if (aiFromSetup) {
        startGeneratedQuiz(lastGenerateSelection);
        return;
    }
    const origin = blockFromId(quizScopeBlockId);
    if (origin && quizScope === 'ai') {
        // Return to the assessed block first, for two reasons: startBlockAiQuiz
        // reads currentTheory, so it must be THIS block; and generation takes
        // 25-35 s with its status line in the reader -- left on the result
        // screen, the click would show nothing for half a minute.
        returnToReader(origin);
        startBlockAiQuiz();
        return;
    }
    startGeneratedQuiz();
});
dom.resultBackBtn.addEventListener('click', () => returnToReader(blockFromId(quizScopeBlockId)));
dom.resultNextBtn.addEventListener('click', () => {
    const origin = blockFromId(quizScopeBlockId);
    const next = origin ? nextTheory(origin) : null;
    if (next) returnToReader(next);
});

// The tab says GENERATE QUIZ, so it generates. It used to reopen the last
// generated quiz whenever one existed, which meant the tab only ever generated
// once per session and silently showed a stale quiz after that.
dom.navGeneratedQuiz.addEventListener('click', () => openQuizTab('generate'));

// The written bank. Coming back from an AI quiz resets to the whole module; a
// block slice is left alone, because that IS the written bank, just scoped.
// The written bank. Opens the picker; an unfinished written quiz is offered as Resume there.
dom.navQuiz.addEventListener('click', () => openQuizTab('practice'));

function loadModuleData(parsedData, fallbackTitle) {
    if (!parsedData.tutorialData || !parsedData.quizData || !Array.isArray(parsedData.quizData)) {
        throw new Error("Invalid JSON schema. Must contain 'tutorialData' object and 'quizData' array.");
    }

    tutorialData = parsedData.tutorialData;
    quizData = parsedData.quizData;
    generatedQuizData = null;
    setModuleQuiz();
    // A different module starts from its own progress, never the last one's.
    moduleId = moduleIdFor(parsedData);
    loadQuizSessions();
    progress = { completed: {} };
    refreshProgress();

    renderTutorial();
    setAppState(true, tutorialData.title || fallbackTitle);
    showLandingDashboard();
}

dom.customDataUpload.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const parsedData = JSON.parse(e.target.result);
            loadModuleData(parsedData, 'Custom Course Module');
            
        } catch (error) {
            console.error("JSON error:", error);
            alert("Failed to load data: " + error.message);
        }
        dom.customDataUpload.value = '';
    };
    reader.readAsText(file);
});

// Helper Function that injects the WebComponent
function formatText(text) {
    if (!text) return '';
    const viewer = document.createElement('rich-text-viewer');
    viewer.setAttribute('content', encodeURIComponent(text));
    return viewer.outerHTML;
}

// --- Theory reader: one block at a time, with a chapter/block table of
// contents on the left. Replaces the original renderTutorial(), which
// concatenated every chapter of every section into one scrolling page.
let currentTheory = { chapterIndex: 0, blockIndex: 0 };

function theoryChapters() {
    return Array.isArray(tutorialData.sections) ? tutorialData.sections : [];
}

// The bank already carries the link back to the block that produced each
// question: quizData[i].source = {chapter, block: 'ch01-b07', question}.
// Verified against the shipped module: all 109 block ids derive exactly from
// (chapter ordinal, item ordinal), zero mismatches -- so this is a lookup, not
// a guess. 15 of the 124 blocks have no pre-written question; those fall back
// to the AI generator.
function theoryBlockId(chapterIndex, blockIndex) {
    const pad = n => String(n + 1).padStart(2, '0');
    return `ch${pad(chapterIndex)}-b${pad(blockIndex)}`;
}

function quizForBlock(chapterIndex, blockIndex) {
    if (!Array.isArray(quizData)) return [];
    const wanted = theoryBlockId(chapterIndex, blockIndex);
    return quizData.filter(q => q && q.source && q.source.block === wanted);
}

function currentBlockQuiz() {
    return quizForBlock(currentTheory.chapterIndex, currentTheory.blockIndex);
}

function theoryBlocks(chapterIndex) {
    const chapter = theoryChapters()[chapterIndex];
    if (!chapter || !Array.isArray(chapter.items)) return [];
    // A populated module stores objects ({term, blocks}); older hand-written
    // modules stored plain strings. Wrap the legacy shape so both render.
    return chapter.items.map((item, index) =>
        typeof item === 'string'
            ? { term: `Point ${index + 1}`, blocks: [{ type: 'text', content: item }] }
            : item
    );
}

function clampTheory(selection) {
    const chapterIndex = Math.min(Math.max(selection.chapterIndex, 0), Math.max(theoryChapters().length - 1, 0));
    const blocks = theoryBlocks(chapterIndex);
    return { chapterIndex, blockIndex: Math.min(Math.max(selection.blockIndex, 0), Math.max(blocks.length - 1, 0)) };
}

function theoryFromHash() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    const chapter = Number(params.get('chapter'));
    const block = Number(params.get('block'));
    return { chapterIndex: (chapter > 0 ? chapter : 1) - 1, blockIndex: (block > 0 ? block : 1) - 1 };
}

function writeTheoryHash() {
    // Deep linking: the URL reflects the block on screen so it can be shared.
    history.replaceState(null, '', `#chapter=${currentTheory.chapterIndex + 1}&block=${currentTheory.blockIndex + 1}`);
}

function previousTheory() {
    if (currentTheory.blockIndex > 0) return { chapterIndex: currentTheory.chapterIndex, blockIndex: currentTheory.blockIndex - 1 };
    for (let c = currentTheory.chapterIndex - 1; c >= 0; c -= 1) {
        const blocks = theoryBlocks(c);
        if (blocks.length) return { chapterIndex: c, blockIndex: blocks.length - 1 };
    }
    return null;
}

function nextTheory(from = currentTheory) {
    if (from.blockIndex + 1 < theoryBlocks(from.chapterIndex).length) {
        return { chapterIndex: from.chapterIndex, blockIndex: from.blockIndex + 1 };
    }
    for (let c = from.chapterIndex + 1; c < theoryChapters().length; c += 1) {
        if (theoryBlocks(c).length) return { chapterIndex: c, blockIndex: 0 };
    }
    return null;
}

// Inline SVG is injected as markup, so strip the two things that make markup
// dangerous. The module we ship is ours, but a custom module can be uploaded
// from disk, and "it is our own data" is not a security model.
// NOTE: formatText() -> marked.parse() -> innerHTML has the same exposure and
// predates this; it is flagged, not fixed here.
function sanitizeSvg(markup) {
    const holder = document.createElement('div');
    holder.innerHTML = String(markup || '');
    holder.querySelectorAll('script, foreignObject, iframe, object, embed').forEach(el => el.remove());
    holder.querySelectorAll('*').forEach(el => {
        [...el.attributes].forEach(attr => {
            const name = attr.name.toLowerCase();
            if (name.startsWith('on')) el.removeAttribute(attr.name);
            if ((name === 'href' || name === 'xlink:href') && /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
        });
    });
    return holder.innerHTML;
}

// --- Book assets: the book's own figures and equations -----------------------
// Written by the importer at import time; served from /assets/<moduleId>/.
function bookImage(src, alt) {
    const frame = document.createElement('div');
    // Book figures are printed on white; a white card keeps them legible on the
    // dark page instead of floating as a bright rectangle.
    frame.className = 'rounded-lg bg-white p-3 flex justify-center';
    const img = document.createElement('img');
    img.src = src;
    img.alt = alt || '';
    img.loading = 'lazy';
    img.className = 'max-w-full h-auto';
    frame.appendChild(img);
    return frame;
}

function renderEquationInto(holder, block) {
    // LaTeX is rendered directly with KaTeX -- never through Markdown, which eats
    // "\\" line breaks and reads "^*" as emphasis. Anything that fails to parse
    // falls back to the book's own picture: a wrong formula is worse than a picture.
    if (block.latex && typeof katex !== 'undefined') {
        try {
            const math = document.createElement('div');
            math.className = 'overflow-x-auto text-white text-[1.15em] py-2';
            katex.render(block.latex, math, { displayMode: true, throwOnError: true });
            holder.appendChild(math);
            return true;
        } catch (error) {
            // fall through to the picture
        }
    }
    if (block.src) holder.appendChild(bookImage(block.src, block.title));
    return false;
}

function assetPanel(block, compact) {
    const panel = document.createElement('figure');
    panel.className = compact
        ? 'mb-6 rounded-xl border border-gray-700 bg-gray-900/60 p-4'
        : 'my-8 rounded-xl border border-gray-700 bg-gray-900/60 p-5';
    if (block.title) {
        const title = document.createElement('h3');
        title.className = 'text-sm font-semibold uppercase tracking-widest text-gray-400 mb-3';
        title.textContent = block.title;
        panel.appendChild(title);
    }
    if (block.type === 'equation') {
        const holder = document.createElement('div');
        const renderedAsLatex = renderEquationInto(holder, block);
        panel.appendChild(holder);
        if (renderedAsLatex && block.src) {
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'mt-2 min-h-[44px] text-xs font-semibold uppercase tracking-wider text-gray-400 hover:text-white';
            toggle.textContent = "Show the book's version";
            let original = null;
            toggle.addEventListener('click', () => {
                if (!original) { original = bookImage(block.src, block.title); original.classList.add('mt-2'); panel.insertBefore(original, toggle.nextSibling); }
                else { original.classList.toggle('hidden-view'); }
                toggle.textContent = original.classList.contains('hidden-view') ? "Show the book's version" : "Hide the book's version";
            });
            panel.appendChild(toggle);
        }
    } else if (block.src) {
        panel.appendChild(bookImage(block.src, block.alt || block.title));
    }
    if (block.caption) {
        const caption = document.createElement('figcaption');
        caption.className = 'mt-3 text-sm text-gray-400 italic text-center max-w-[68ch] mx-auto';
        caption.textContent = block.caption;
        panel.appendChild(caption);
    }
    return panel;
}

function appendTheoryContent(parent, block, theme) {
    if (!block || typeof block !== 'object') return;
    if (block.type === 'equation' || (block.type === 'figure' && block.src && !block.svg)) {
        parent.appendChild(assetPanel(block, false));
        return;
    }
    if (block.type === 'text') {
        const wrapper = document.createElement('div');
        // Capped measure: ~68 characters a line is the readable band. The
        // container is max-w-none so a figure can still go full width.
        wrapper.className = 'mb-6 leading-relaxed max-w-[68ch]';
        wrapper.innerHTML = formatText(block.content);
        parent.appendChild(wrapper);
        return;
    }
    // Visual block. `svg` is inline markup (preferred: no asset files, scales,
    // themeable); `src` is an image path. Either may carry a caption.
    if (block.type === 'figure' || block.type === 'diagram') {
        const figure = document.createElement('figure');
        figure.className = 'my-8 rounded-xl border border-gray-700 bg-gray-900/60 p-5 overflow-x-auto';
        if (block.title) {
            const title = document.createElement('h3');
            title.className = 'text-sm font-semibold uppercase tracking-widest text-gray-400 mb-4';
            title.textContent = block.title;
            figure.appendChild(title);
        }
        if (block.svg) {
            const holder = document.createElement('div');
            holder.className = 'w-full flex justify-center [&>svg]:max-w-full [&>svg]:h-auto';
            holder.innerHTML = sanitizeSvg(block.svg);
            figure.appendChild(holder);
        } else if (block.src) {
            const img = document.createElement('img');
            img.src = block.src;
            img.alt = block.alt || block.caption || '';
            img.loading = 'lazy';
            img.className = 'mx-auto max-w-full h-auto rounded-lg';
            figure.appendChild(img);
        }
        if (block.caption) {
            const caption = document.createElement('figcaption');
            caption.className = 'mt-4 text-sm text-gray-400 italic text-center max-w-[68ch] mx-auto';
            caption.innerHTML = formatText(block.caption);
            figure.appendChild(caption);
        }
        parent.appendChild(figure);
        return;
    }
    const panel = document.createElement('section');
    panel.className = block.type === 'callout'
        ? 'my-6 rounded-xl border border-brand-600/40 bg-brand-600/5 p-5'
        : 'my-6 rounded-xl border border-gray-700 bg-gray-900/60 p-5';
    if (block.title) {
        const title = document.createElement('h3');
        title.className = block.type === 'callout'
            ? 'text-lg font-semibold text-brand-400 mb-3'
            : `text-lg font-semibold text-${theme} mb-3`;
        title.textContent = block.title;
        panel.appendChild(title);
    }
    if (block.content || block.intro) {
        const intro = document.createElement('div');
        intro.className = 'leading-relaxed';
        intro.innerHTML = formatText(block.content || block.intro);
        panel.appendChild(intro);
    }
    const bullets = Array.isArray(block.items) ? block.items : (Array.isArray(block.bullets) ? block.bullets : null);
    if (bullets) {
        const list = document.createElement('ul');
        list.className = 'mt-3 space-y-3';
        bullets.forEach(entry => {
            const liClone = templates.tutorialListItem.content.cloneNode(true);
            liClone.querySelector('span').innerHTML = formatText(entry);
            list.appendChild(liClone);
        });
        panel.appendChild(list);
    }
    parent.appendChild(panel);
}

function renderTheoryToc() {
    if (!dom.tocNav) return;
    dom.tocNav.innerHTML = '';
    const chapters = theoryChapters();
    const totalBlocks = chapters.reduce((sum, _chapter, index) => sum + theoryBlocks(index).length, 0);
    const overall = overallProgress();
    if (dom.tocSummary) {
        dom.tocSummary.textContent =
            `${chapters.length} chapters · ${totalBlocks} blocks · ${overall.done}/${overall.total} done (${overall.percent}%)`;
    }

    chapters.forEach((chapter, chapterIndex) => {
        const blocks = theoryBlocks(chapterIndex);
        const group = document.createElement('details');
        group.className = 'rounded-lg';
        group.open = chapterIndex === currentTheory.chapterIndex;

        const done = chapterProgress(chapterIndex);
        const summary = document.createElement('summary');
        summary.className = 'cursor-pointer select-none rounded-lg px-3 py-3 text-sm font-semibold text-gray-200 hover:bg-gray-700 transition-colors';

        const summaryTop = document.createElement('div');
        summaryTop.className = 'flex items-baseline justify-between gap-2';
        const summaryName = document.createElement('span');
        summaryName.className = 'min-w-0';
        summaryName.textContent = chapter.title;
        const summaryPct = document.createElement('span');
        summaryPct.className = 'shrink-0 text-xs font-bold tabular-nums ' + (done.percent === 100 ? 'text-green-400' : done.percent > 0 ? 'text-brand-400' : 'text-gray-500');
        summaryPct.textContent = `${done.percent}%`;
        summaryTop.appendChild(summaryName);
        summaryTop.appendChild(summaryPct);
        summary.appendChild(summaryTop);

        const meter = document.createElement('div');
        meter.className = 'mt-2 h-1 w-full rounded-full bg-gray-700 overflow-hidden';
        meter.setAttribute('role', 'progressbar');
        meter.setAttribute('aria-valuenow', String(done.percent));
        meter.setAttribute('aria-valuemin', '0');
        meter.setAttribute('aria-valuemax', '100');
        meter.setAttribute('aria-label', `${chapter.title} progress`);
        const fill = document.createElement('div');
        fill.className = 'h-full rounded-full transition-all ' + (done.percent === 100 ? 'bg-green-500' : 'bg-brand-600');
        fill.style.width = `${done.percent}%`;
        meter.appendChild(fill);
        summary.appendChild(meter);

        const count = document.createElement('div');
        count.className = 'mt-1 text-[0.7rem] font-normal text-gray-500 tabular-nums';
        count.textContent = `${done.done} of ${done.total} blocks`;
        summary.appendChild(count);
        group.appendChild(summary);

        const list = document.createElement('ol');
        list.className = 'mb-2 px-2 space-y-1';
        blocks.forEach((block, blockIndex) => {
            const isCurrent = chapterIndex === currentTheory.chapterIndex && blockIndex === currentTheory.blockIndex;
            const item = document.createElement('li');
            const button = document.createElement('button');
            // Active State: the block on screen is visually marked in the list.
            button.className = 'w-full text-left rounded-md px-3 py-2 text-sm leading-5 min-h-[44px] transition-colors ' + (isCurrent
                ? 'bg-brand-600/15 text-white font-semibold border-l-2 border-brand-600'
                : 'text-gray-400 hover:bg-gray-700 hover:text-white border-l-2 border-transparent');
            const complete = isBlockComplete(chapterIndex, blockIndex);
            button.textContent = `${complete ? '✓ ' : ''}${blockIndex + 1}. ${block.term || 'Theory block'}`;
            if (complete) {
                button.classList.add('text-green-400');
                button.classList.remove('text-gray-400');
                button.title = 'Completed — 100% on this block’s assessment';
            }
            if (isCurrent) button.setAttribute('aria-current', 'true');
            button.addEventListener('click', () => {
                selectTheory({ chapterIndex, blockIndex });
                if (!isWideViewport()) setTocOpen(false);
            });
            item.appendChild(button);
            list.appendChild(item);
        });
        group.appendChild(list);
        dom.tocNav.appendChild(group);
    });
}

function renderTheoryBlock() {
    const chapter = theoryChapters()[currentTheory.chapterIndex];
    const blocks = theoryBlocks(currentTheory.chapterIndex);
    const block = blocks[currentTheory.blockIndex];
    if (!chapter || !block) return;
    const theme = chapter.themeColor || 'brand-600';

    if (dom.theoryChapterLabel) dom.theoryChapterLabel.textContent = chapter.title;
    const blockDone = isBlockComplete(currentTheory.chapterIndex, currentTheory.blockIndex);
    if (dom.theoryBlockPosition) {
        dom.theoryBlockPosition.textContent =
            `Block ${currentTheory.blockIndex + 1} of ${blocks.length}${blockDone ? ' · ✓ completed' : ''}`;
        dom.theoryBlockPosition.className = blockDone ? 'text-green-400' : '';
    }
    dom.tutorialTitle.textContent = block.term || `Theory block ${currentTheory.blockIndex + 1}`;
    dom.tutorialLead.textContent = chapter.note || '';

    dom.tutorialContent.innerHTML = '';
    (Array.isArray(block.blocks) ? block.blocks : []).forEach(content => appendTheoryContent(dom.tutorialContent, content, theme));

    const previous = previousTheory();
    const next = nextTheory();
    if (dom.prevBlockBtn) dom.prevBlockBtn.disabled = !previous;
    if (dom.nextBlockBtn) dom.nextBlockBtn.disabled = !next;
    if (dom.aiBlockStatus) dom.aiBlockStatus.textContent = '';
    renderBlockQuizButton();
}

// The button says how many questions this block actually has, so you never
// start an assessment without knowing its size -- and the 15 blocks with no
// written questions say so instead of silently opening the AI generator.
function renderBlockQuizButton() {
    if (!dom.tutorialToQuizLabel) return;
    const count = currentBlockQuiz().length;
    const done = isBlockComplete(currentTheory.chapterIndex, currentTheory.blockIndex);
    const verb = done ? 'Retake' : 'Begin Assessment';
    if (count > 0) {
        dom.tutorialToQuizLabel.textContent = `${verb} · ${count} question${count === 1 ? '' : 's'}`;
        dom.tutorialToQuizBtn.title = done
            ? 'Already completed. Retaking cannot un-complete it.'
            : 'Assess only the block you are reading — 100% marks it complete';
    } else {
        dom.tutorialToQuizLabel.textContent = `${verb} · AI-written`;
        dom.tutorialToQuizBtn.title = 'This block has no written questions; the connected model writes them';
    }
}

function selectTheory(selection) {
    currentTheory = clampTheory(selection);
    writeTheoryHash();
    renderTheoryToc();
    renderTheoryBlock();
}

// Entry point kept under the original name so loadModuleData() is untouched.
function renderTutorial() {
    if (!tutorialData || !tutorialData.sections) return;
    currentTheory = clampTheory(theoryFromHash());
    renderTheoryToc();
    renderTheoryBlock();
}

function loadQuestion() {
    isAnswered = false;
    selectedAnswer = null;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const currentQ = activeQuizData[currentQuestionIndex];
    
    dom.questionNumberBadge.textContent = currentQuestionIndex + 1;
    dom.questionText.innerHTML = formatText(currentQ.question);
    // A question about a figure or equation shows it above the question.
    if (dom.questionAsset) {
        dom.questionAsset.replaceChildren();
        if (currentQ.asset && typeof currentQ.asset === 'object') {
            dom.questionAsset.appendChild(assetPanel(currentQ.asset, true));
        }
    }
    
    if (currentQuestionIndex === activeQuizData.length - 1) {
        dom.nextBtnText.textContent = "Finish Assessment";
    } else {
        dom.nextBtnText.textContent = "Next Question";
    }
    
    const progressPercent = ((currentQuestionIndex) / activeQuizData.length) * 100;
    dom.progressBar.style.width = `${progressPercent}%`;

    dom.actionContainer.classList.add('hidden-view');
    dom.optionsContainer.innerHTML = '';

    currentQ.options.forEach((optionText, index) => {
        const optionClone = templates.quizOption.content.cloneNode(true);
        const btn = optionClone.querySelector('.option-card');
        const letterSpan = optionClone.querySelector('.option-letter');
        const textSpan = optionClone.querySelector('.option-text');
        
        const letter = String.fromCharCode(65 + index);
        letterSpan.textContent = letter;
        textSpan.innerHTML = formatText(optionText);
        
        btn.addEventListener('click', () => handleAnswerSelect(index, btn));
        dom.optionsContainer.appendChild(optionClone);
    });
}

function handleAnswerSelect(selectedIndex, selectedBtn, replay = false) {
    if (isAnswered && !replay) return;
    isAnswered = true;
    selectedAnswer = selectedIndex;

    const currentQ = activeQuizData[currentQuestionIndex];
    const isCorrect = selectedIndex === currentQ.correct;

    // A replay redraws an answer given before the learner left the screen; it was scored then.
    if (isCorrect && !replay) {
        score++;
    }
    dom.scoreTracker.textContent = score;

    const allCards = dom.optionsContainer.querySelectorAll('.option-card');
    
    allCards.forEach((card, index) => {
        card.classList.add('answered', 'cursor-default');
        const letterBadge = card.querySelector('.option-letter');
        const explContainer = card.querySelector('.explanation-text');
        const explInner = card.querySelector('.explanation-inner');
        
        const isOptionCorrect = index === currentQ.correct;
        
        explInner.innerHTML = '';
        const titleSpan = document.createElement('span');
        titleSpan.className = 'block mb-1 font-bold tracking-wider text-xs uppercase';
        const explSpan = document.createElement('span');
        explSpan.className = 'text-gray-400 leading-relaxed';
        explSpan.innerHTML = formatText(currentQ.explanations[index]);
        
        if (isOptionCorrect) {
            titleSpan.textContent = 'Correct Answer';
            titleSpan.classList.add('text-emerald-400');
            explInner.appendChild(titleSpan);
            explInner.appendChild(explSpan);
            
            card.classList.remove('border-transparent');
            card.style.borderColor = '#10b981'; 
            card.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
            letterBadge.classList.remove('bg-gray-800', 'text-gray-400');
            letterBadge.style.backgroundColor = '#10b981';
            letterBadge.style.color = '#ffffff';
            
        } else {
            titleSpan.textContent = 'Incorrect';
            titleSpan.classList.add('text-brand-400'); 
            explInner.appendChild(titleSpan);
            explInner.appendChild(explSpan);
            
            if (index === selectedIndex) {
                card.classList.remove('border-transparent');
                card.style.borderColor = '#ef4444'; 
                card.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'; 
                letterBadge.classList.remove('bg-gray-800', 'text-gray-400');
                letterBadge.style.backgroundColor = '#ef4444';
                letterBadge.style.color = '#ffffff';
            } else {
                card.classList.add('opacity-50');
            }
        }
        
        setTimeout(() => {
            explContainer.classList.add('expanded');
        }, 50 * index); 
    });

    dom.actionContainer.classList.remove('hidden-view');
    if (replay) return;
    saveQuizSession();
    setTimeout(() => {
        dom.actionContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 400);
}

// Ask once for the learner token when the server enforces one. Returns null when
// the learner cancels, so the caller can stop without a request.
function generationToken() {
    if (!providerTokenRequired) return '';
    return window.prompt('Generation access token') || null;
}

async function startGeneratedQuiz(selection = []) {
    if (!tutorialData.title || !providerReady) return;
    const token = generationToken();
    if (token === null) return;

    dom.contentSection.classList.add('hidden-view');
    dom.landingDashboard.classList.remove('hidden-view');
    dom.emptyState.classList.add('hidden-view');
    dom.welcomeScreen.classList.add('hidden-view');
    dom.servicesSection.classList.add('hidden-view');
    dom.loadingScreen.classList.remove('hidden-view');

    window.scrollTo({ top: 0, behavior: 'smooth' });
    updateNavUI('generated-quiz');

    if (dom.loadingModel) dom.loadingModel.textContent = providerModel ? `Model: ${providerModel}` : '';
    if (dom.loadingScope) dom.loadingScope.textContent = generateScopeText(selection);

    const picked = selection.map(blockFromId).filter(Boolean);
    const oneBlock = picked.length === 1 ? picked[0] : null;
    const request = oneBlock
        ? { url: 'api/quiz', body: { chapter: oneBlock.chapterIndex + 1, block: oneBlock.blockIndex + 1, count: aiQuestionCount } }
        : { url: 'api/quiz/fresh', body: { count: generatedCountFor(picked.length),
                                           ...(picked.length ? { blocks: picked.map(b => [b.chapterIndex + 1, b.blockIndex + 1]) } : {}) } };
    try {
        const response = await fetch(request.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Edu-Quiz-Token': token },
            body: JSON.stringify(request.body)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
        // One block owns a one-block quiz, so a perfect score completes it as in the reader.
        setAiQuiz(data.questions, oneBlock ? theoryBlockId(oneBlock.chapterIndex, oneBlock.blockIndex) : null);
        aiFromSetup = true;
        lastGenerateSelection = selection;
        quizOrigin = 'tab';
        startQuiz();
    } catch (error) {
        alert(`Could not generate a quiz: ${error.message}`);
        showLandingDashboard();
    }
}

// The server writes up to 5 questions per book section, so a small pick cannot fill a big quiz.
function generatedCountFor(blockCount) {
    const cap = Math.min(GENERATED_QUIZ_SIZE, MAX_FRESH_QUIZ_SIZE);
    return blockCount ? Math.max(5, Math.min(cap, blockCount * 5)) : cap;
}

function generateScopeText(selection) {
    const picked = selection.map(blockFromId).filter(Boolean);
    if (!picked.length) return 'AI is reading random book sections · up to a minute';
    if (picked.length > 1) return `AI is reading ${picked.length} blocks · up to a minute`;
    const item = theoryBlocks(picked[0].chapterIndex)[picked[0].blockIndex];
    return `AI is reading ${(item && item.term) || 'one block'} · under a minute`;
}

// --- Quiz setup ---------------------------------------------------------------
// PRACTICE and GENERATE QUIZ open this first. The learner ticks any mix of chapters
// and blocks, and unticks them again (user, 17-09-26: "I want to select multiple and
// deselect"). The selection is a set of block ids like "ch01-b06".
let setupMode = 'practice';
let aiFromSetup = false;
let lastGenerateSelection = [];
const setupSelected = new Set();
const CHECKBOX_CLASS = 'h-5 w-5 shrink-0 cursor-pointer rounded accent-brand-600';

function readSetupChoice(mode) {
    try { const saved = JSON.parse(localStorage.getItem(`eduQuizSetup.${mode}`) || '[]'); return Array.isArray(saved) ? saved : []; }
    catch (error) { return []; }
}

function saveSetupChoice(mode, ids) {
    try { localStorage.setItem(`eduQuizSetup.${mode}`, JSON.stringify(ids)); } catch (error) { /* per-viewer convenience only */ }
}

// Every block id in reading order, so a selection always runs in book order.
function allBlockIds() {
    return theoryChapters().flatMap((_chapter, ci) => theoryBlocks(ci).map((_block, bi) => theoryBlockId(ci, bi)));
}

function selectedBlockIds() {
    return allBlockIds().filter(id => setupSelected.has(id));
}

function chapterName(chapterIndex) {
    const chapter = theoryChapters()[chapterIndex];
    // Titles already read "Chapter 3: Classification"; numbering them again gave "3. Chapter 3: ...".
    return String((chapter && chapter.title) || '').replace(/^chapter\s+\d+\s*[:.\-–—]\s*/i, '') || `Chapter ${chapterIndex + 1}`;
}

function practiceQuestionsFor(ids) {
    const wanted = new Set(ids);
    return quizData.filter(q => q && q.source && wanted.has(q.source.block));
}

function renderSetupTree() {
    dom.setupTree.innerHTML = '';
    theoryChapters().forEach((_chapter, ci) => {
        const blocks = theoryBlocks(ci);
        const group = document.createElement('div');
        group.dataset.chapterGroup = String(ci);

        const head = document.createElement('div');
        // Sticky, so a long chapter's blocks never scroll away from the chapter they belong to.
        head.className = 'sticky top-0 z-10 flex items-center gap-1 pr-3 bg-gray-900';
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.dataset.toggle = String(ci);
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-controls', `setup-blocks-${ci}`);
        toggle.setAttribute('aria-label', `Blocks of chapter ${ci + 1}`);
        toggle.className = 'min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-gray-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';
        toggle.innerHTML = '<svg class="w-4 h-4 transition-transform" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>';
        const label = document.createElement('label');
        label.className = 'flex flex-1 min-w-0 items-center gap-3 min-h-[44px] cursor-pointer';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.className = CHECKBOX_CLASS;
        box.dataset.chapter = String(ci);
        const name = document.createElement('span');
        name.className = 'truncate text-white';
        name.textContent = `${ci + 1}. ${chapterName(ci)}`;
        const tally = document.createElement('span');
        tally.className = 'ml-auto shrink-0 pl-2 text-xs text-gray-400 tabular-nums';
        tally.dataset.tally = String(ci);
        label.append(box, name, tally);
        head.append(toggle, label);

        const list = document.createElement('ul');
        list.id = `setup-blocks-${ci}`;
        list.className = 'hidden-view pb-2';
        blocks.forEach((item, bi) => {
            const row = document.createElement('li');
            const rowLabel = document.createElement('label');
            rowLabel.className = 'flex items-center gap-3 min-h-[44px] pl-14 pr-3 cursor-pointer hover:bg-gray-800/60';
            const blockBox = document.createElement('input');
            blockBox.type = 'checkbox';
            blockBox.className = CHECKBOX_CLASS;
            blockBox.dataset.block = theoryBlockId(ci, bi);
            const term = document.createElement('span');
            term.className = 'min-w-0 text-sm text-gray-300';
            term.textContent = `${bi + 1}. ${(item && item.term) || `Block ${bi + 1}`}`;
            rowLabel.append(blockBox, term);
            row.appendChild(rowLabel);
            list.appendChild(row);
        });
        group.append(head, list);
        dom.setupTree.appendChild(group);
    });
}

function setChapterOpen(chapterIndex, open) {
    const toggle = dom.setupTree.querySelector(`[data-toggle="${chapterIndex}"]`);
    const list = document.getElementById(`setup-blocks-${chapterIndex}`);
    if (!toggle || !list) return;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.firstElementChild.classList.toggle('rotate-90', open);
    list.classList.toggle('hidden-view', !open);
}

// Checkbox state is derived from the set, never the other way round.
function syncSetupTree() {
    theoryChapters().forEach((_chapter, ci) => {
        const ids = theoryBlocks(ci).map((_block, bi) => theoryBlockId(ci, bi));
        const picked = ids.filter(id => setupSelected.has(id)).length;
        const box = dom.setupTree.querySelector(`[data-chapter="${ci}"]`);
        if (box) {
            box.checked = picked > 0 && picked === ids.length;
            box.indeterminate = picked > 0 && picked < ids.length;
        }
        const tally = dom.setupTree.querySelector(`[data-tally="${ci}"]`);
        if (tally) tally.textContent = picked ? `${picked}/${ids.length}` : `${ids.length}`;
    });
    dom.setupTree.querySelectorAll('[data-block]').forEach(box => { box.checked = setupSelected.has(box.dataset.block); });
    renderSetupCount();
}

function renderSetupCount() {
    const ids = selectedBlockIds();
    const blocks = `${ids.length} block${ids.length === 1 ? '' : 's'}`;
    let text;
    let ready = ids.length > 0;
    if (!ids.length) {
        text = 'Nothing selected';
    } else if (setupMode === 'practice') {
        const count = practiceQuestionsFor(ids).length;
        text = `${blocks} · ${count} question${count === 1 ? '' : 's'}`;
        ready = count > 0;
    } else if (!providerReady) {
        text = 'No model connected';
        ready = false;
    } else {
        const count = ids.length === 1 ? aiQuestionCount : generatedCountFor(ids.length);
        text = `${blocks} · ${count} AI questions`;
    }
    dom.setupCount.textContent = text;
    dom.setupStartBtn.disabled = !ready;
}

function openQuizSetup(mode) {
    if (!tutorialData.title) return;
    setupMode = mode;
    dom.setupTitle.textContent = mode === 'practice' ? 'Practice' : 'Generate quiz';

    renderSetupTree();
    const valid = new Set(allBlockIds());
    setupSelected.clear();
    readSetupChoice(mode).forEach(id => { if (valid.has(id)) setupSelected.add(id); });
    syncSetupTree();
    // Open the chapters that hold a selection, so a saved pick is visible, not hidden.
    theoryChapters().forEach((_chapter, ci) => {
        const any = theoryBlocks(ci).some((_block, bi) => setupSelected.has(theoryBlockId(ci, bi)));
        setChapterOpen(ci, any);
    });

    const saved = quizSessions[mode];
    dom.setupResumeBtn.classList.toggle('hidden-view', !saved);
    if (saved) {
        dom.setupResumeBtn.textContent = sessionFinished(saved)
            ? 'Back to results' : `Resume ${saved.currentQuestionIndex + 1}/${saved.questions.length}`;
    }

    dom.landingDashboard.classList.add('hidden-view');
    dom.contentSection.classList.remove('hidden-view');
    dom.tutorialScreen.classList.add('hidden-view');
    dom.settingsScreen.classList.add('hidden-view');
    dom.quizScreen.classList.add('hidden-view');
    dom.resultScreen.classList.add('hidden-view');
    dom.progressContainer.classList.add('hidden-view');
    dom.quizSetupScreen.classList.remove('hidden-view');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    updateNavUI(mode === 'practice' ? 'quiz' : 'generated-quiz');
}

dom.setupTree.addEventListener('change', event => {
    const target = event.target;
    if (target.dataset.block) {
        if (target.checked) setupSelected.add(target.dataset.block); else setupSelected.delete(target.dataset.block);
    } else if (target.dataset.chapter) {
        const ci = Number(target.dataset.chapter);
        theoryBlocks(ci).forEach((_block, bi) => {
            const id = theoryBlockId(ci, bi);
            if (target.checked) setupSelected.add(id); else setupSelected.delete(id);
        });
    }
    syncSetupTree();
});
dom.setupTree.addEventListener('click', event => {
    const toggle = event.target.closest('[data-toggle]');
    if (!toggle) return;
    setChapterOpen(Number(toggle.dataset.toggle), toggle.getAttribute('aria-expanded') !== 'true');
});
dom.setupAllBtn.addEventListener('click', () => { allBlockIds().forEach(id => setupSelected.add(id)); syncSetupTree(); });
dom.setupNoneBtn.addEventListener('click', () => { setupSelected.clear(); syncSetupTree(); });
dom.setupResumeBtn.addEventListener('click', () => resumeQuizSession(setupMode));
dom.setupStartBtn.addEventListener('click', () => {
    const ids = selectedBlockIds();
    if (!ids.length) return;
    saveSetupChoice(setupMode, ids);
    if (setupMode === 'generate') {
        // Everything ticked is the same as no restriction: draw from the whole book.
        startGeneratedQuiz(ids.length === allBlockIds().length ? [] : ids);
        return;
    }
    const questions = practiceQuestionsFor(ids);
    const every = allBlockIds();
    if (ids.length === every.length) {
        setModuleQuiz();
    } else if (ids.length === 1) {
        const only = blockFromId(ids[0]);
        setBlockQuiz(questions, only.chapterIndex, only.blockIndex);
    } else {
        const chapters = [...new Set(ids.map(id => blockFromId(id).chapterIndex))];
        const wholeChapter = chapters.length === 1 && ids.length === theoryBlocks(chapters[0]).length;
        setSelectionQuiz(questions, wholeChapter
            ? (theoryChapters()[chapters[0]].title || `Chapter ${chapters[0] + 1}`)
            : `${ids.length} blocks from ${chapters.length} chapter${chapters.length === 1 ? '' : 's'}`);
    }
    quizOrigin = 'tab';
    startQuiz();
});

async function loadBundledModule() {
    setAppState(false); 

    try {
        const response = await fetch(BUNDLED_MODULE_URL);
        if (!response.ok) {
            throw new Error(`Bundled module request failed with status ${response.status}.`);
        }
        loadModuleData(await response.json(), 'Hands-On Machine Learning');
    } catch (error) {
        console.error('Failed to load bundled learning module:', error);
        setAppState(false);
    }
}

document.addEventListener('DOMContentLoaded', loadBundledModule);


// --- AI quiz for the block on screen ----------------------------------------
// The key lives only in the server's environment; the browser sends the block
// coordinates and an access token, never a provider credential.
function setAiBlockStatus(message) {
    if (dom.aiBlockStatus) dom.aiBlockStatus.textContent = message || '';
}

async function refreshProviderStatus() {
    try {
        const response = await fetch('api/provider', { cache: 'no-store' });
        const data = await response.json();
        providerReady = Boolean(data.ready);
        providerTokenRequired = Boolean(data.token_required);
        providerModel = data.model || '';
        dom.blockAiQuizBtn.disabled = !providerReady;
        dom.blockAiQuizBtn.title = providerReady
            ? `Generate questions with ${data.model}`
            : 'Unavailable until an operator configures a provider on the server';
    } catch (error) {
        providerReady = false;
        dom.blockAiQuizBtn.disabled = true;
        dom.blockAiQuizBtn.title = 'Provider status unavailable; the book quizzes still work';
    }
    dom.startGeneratedBtn.disabled = !tutorialData.title || !providerReady;
    dom.startGeneratedBtn.title = providerReady ? '' : 'Connect a model in Settings first';
}

async function startBlockAiQuiz() {
    if (!providerReady) return;
    const token = generationToken();
    if (token === null) return;
    setAiBlockStatus('Generating questions from this block...');
    dom.blockAiQuizBtn.disabled = true;
    try {
        const response = await fetch('api/quiz', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Edu-Quiz-Token': token },
            body: JSON.stringify({
                chapter: currentTheory.chapterIndex + 1,
                block: currentTheory.blockIndex + 1,
                count: aiQuestionCount
            })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
        // An AI quiz launched from the reader assesses THIS block, so a perfect
        // score on it completes the block exactly as a written one does.
        setAiQuiz(data.questions, theoryBlockId(currentTheory.chapterIndex, currentTheory.blockIndex));
        aiFromSetup = false;
        quizOrigin = 'reader';
        setAiBlockStatus('');
        startQuiz();
    } catch (error) {
        setAiBlockStatus(error.message);
    } finally {
        dom.blockAiQuizBtn.disabled = !providerReady;
    }
}

document.addEventListener('DOMContentLoaded', refreshProviderStatus);


// --- Settings ---------------------------------------------------------------
// The admin token lives in sessionStorage only: it dies with the tab and is
// never written to disk. The provider API key is never sent to the browser at
// all -- the server reports only whether one is set.
function adminToken() {
    try { return sessionStorage.getItem('eduAdminToken') || ''; } catch (error) { return ''; }
}

function rememberAdminToken(token) {
    try { sessionStorage.setItem('eduAdminToken', token); } catch (error) { /* private mode */ }
}

function fillSettingsForm(data) {
    dom.setApiUrl.value = data.api_url || '';
    dom.setModel.value = data.model || '';
    dom.setJsonMode.checked = data.json_mode !== false;
    dom.setApiKey.value = '';
    dom.setAccessToken.value = '';
    dom.apiKeyState.textContent = data.api_key_set
        ? 'A key is stored on the server. Leave blank to keep it; type a new one to replace it.'
        : 'No key stored yet. Quiz generation stays off until one is saved.';
    dom.accessTokenState.textContent = data.access_token_set
        ? 'A token is stored. Leave blank to keep it.'
        : 'No token stored.';
    dom.setRequireToken.checked = Boolean(data.general.require_access_token);
    dom.setAiCount.value = data.general.ai_question_count;
    dom.setFreshSize.value = data.general.fresh_quiz_size;
    dom.settingsForm.classList.remove('hidden-view');
    dom.settingsLockCard.classList.toggle('hidden-view', !data.admin_required);
    dom.settingsLockStatus.textContent = data.ready
        ? `Connected to ${data.model}. AI quiz generation is on.`
        : 'Not connected yet. Fill in the endpoint, key and model below, then Save.';
}

async function loadSettings() {
    try {
        const response = await fetch('api/settings', { headers: { 'X-Edu-Admin-Token': adminToken() }, cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
        fillSettingsForm(data);
    } catch (error) {
        dom.settingsForm.classList.add('hidden-view');
        dom.settingsLockCard.classList.remove('hidden-view');
        dom.settingsLockStatus.textContent = error.message;
    }
}

async function saveSettings() {
    const payload = {
        api_url: dom.setApiUrl.value.trim(),
        model: dom.setModel.value.trim(),
        json_mode: dom.setJsonMode.checked,
        require_access_token: dom.setRequireToken.checked,
        ai_question_count: Number(dom.setAiCount.value),
        fresh_quiz_size: Number(dom.setFreshSize.value),
    };
    // Only send secrets the operator actually typed, so saving an unrelated
    // preference cannot silently blank a stored credential.
    if (dom.setApiKey.value.trim()) payload.api_key = dom.setApiKey.value.trim();
    if (dom.setAccessToken.value.trim()) payload.access_token = dom.setAccessToken.value.trim();

    dom.settingsSaveBtn.disabled = true;
    dom.settingsStatus.textContent = 'Saving...';
    try {
        const response = await fetch('api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Edu-Admin-Token': adminToken() },
            body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
        fillSettingsForm(data);
        dom.settingsStatus.textContent = data.ready
            ? 'Saved. Quiz generation is live now, no restart needed.'
            : 'Saved, but the provider is still incomplete (endpoint, key and model are all required).';
        await Promise.all([refreshProviderStatus(), loadGeneralSettings()]);
    } catch (error) {
        dom.settingsStatus.textContent = error.message;
    } finally {
        dom.settingsSaveBtn.disabled = false;
    }
}

async function loadGeneralSettings() {
    try {
        const response = await fetch('api/general', { cache: 'no-store' });
        const data = await response.json();
        if (Number(data.fresh_quiz_size) > 0) GENERATED_QUIZ_SIZE = Number(data.fresh_quiz_size);
        if (Number(data.ai_question_count) > 0) aiQuestionCount = Number(data.ai_question_count);
    } catch (error) { /* defaults already set */ }
}

dom.menuBtn.addEventListener('click', () => setMenuOpen(!menuOpen));
dom.navLearn.addEventListener('click', () => { showTutorial(); if (!isWideMenu()) setMenuOpen(false); });
dom.navSettings.addEventListener('click', () => { showSettings(); if (!isWideMenu()) setMenuOpen(false); });
[dom.navTutorial, dom.navQuiz, dom.navGeneratedQuiz].forEach(el =>
    el.addEventListener('click', () => { if (!isWideMenu()) setMenuOpen(false); }));
window.matchMedia(MENU_WIDE).addEventListener('change', syncMenuToViewport);
dom.settingsUnlockBtn.addEventListener('click', () => {
    const token = dom.adminToken.value.trim();
    if (!token) { dom.settingsLockStatus.textContent = 'Enter the admin token first.'; return; }
    rememberAdminToken(token);
    dom.adminToken.value = '';
    loadSettings();
});
dom.settingsSaveBtn.addEventListener('click', saveSettings);
document.addEventListener('DOMContentLoaded', syncMenuToViewport);
document.addEventListener('DOMContentLoaded', loadGeneralSettings);
