// Three Tongues W3 one-shot migration (task 3.2-3.4). Idempotent: each
// replacement asserts application; re-running skips already-migrated text.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const rel = (f) => resolve(ROOT, f);

// ---------- catalog additions ----------
const C = {
	attachImages: ['附加图片', 'Lampirkan gambar'],
	commandHelp: ['命令帮助', 'Bantuan perintah'],
	closePreview: ['关闭预览', 'Tutup pratinjau'],
	originalImagePreview: ['原始图片预览', 'Pratinjau gambar asli'],
	del: ['Del', 'Del'],
	autoCheckTitle: ['自动勾选达到此使用次数的行(0 = 关)', 'Centang otomatis baris dengan pakai sebanyak ini (0 = mati)'],
	selectedRows: ['☑ 已选', '☑ Dipilih'],
	showOnlySelected: ['仅显示已选行', 'Hanya tampilkan baris terpilih'],
	searchPrompts: ['搜索提示…', 'Cari prompt…'],
	close: ['关闭', 'Tutup'],
	promptsManager: ['提示管理器', 'Pengelola prompt'],
	manageSavedPrompts: ['管理已保存的提示', 'Kelola prompt tersimpan'],
	slashMenu: ['斜杠菜单', 'Menu slash'],
	stickToBottom: ['固定到底部', 'Tempel ke bawah'],
	streaming: ['正在输出', 'sedang menyiarkan'],
	tokenCounterTitle: ['草稿的启发式估算(约 4 字符/令牌)', 'Perkiraan heuristik (~4 karakter/token) dari draf'],
	escHidesA: ['按 Esc 隐藏此卡 · 删除', 'Esc menyembunyikan ini · hapus'],
	escHidesB: ['以继续输入', 'untuk terus menulis'],
	filterByDate: ['按日期筛选', 'Filter menurut tanggal'],
	filterSessionsByDate: ['按日期筛选会话', 'Filter sesi menurut tanggal'],
	forkFromTurn: ['从此轮分叉', 'Cabang dari giliran ini'],
	forkFromTurnLong: ['从此轮分叉 — 建立以该轮结束的新会话', 'Cabang dari giliran ini — buat sesi baru berakhir di giliran ini'],
	addWorkspace: ['添加工作区', 'Tambah workspace'],
	previousMonth: ['上个月', 'Bulan sebelumnya'],
	nextMonth: ['下个月', 'Bulan berikutnya'],
	datePicker: ['日期选择器', 'Pemilih tanggal'],
	currentPlan: ['当前计划 (', 'Rencana saat ini ('],
	donePart: [' 完成)', ' selesai)'],
	userMessages: ['用户消息 (', 'Pesan pengguna ('],
	copyReasoning: ['复制推理', 'Salin penalaran'],
	copyOutput: ['复制输出', 'Salin keluaran'],
	toolApproval: ['工具审批:', 'Persetujuan alat:'],
	copyFullPath: ['复制完整路径', 'Salin path lengkap'],
	runtimeContext: ['⚙ 运行时上下文 ·', '⚙ konteks runtime ·'],
	systemPrompt: ['系统提示', 'Prompt sistem'],
	peekToolCalls: ['以列表查看所有工具调用', 'Lihat semua panggilan alat sebagai daftar'],
	turnFailed: ['轮次失败', 'giliran gagal'],
	usage: ['用量', 'Pemakaian'],
	noConversations: ['没有打开的会话。', 'Tidak ada percakapan terbuka.'],
	pickSession: ['从侧栏选择会话,或以 + 新建聊天开始。', 'Pilih sesi dari bilah samping, atau mulai dengan + Obrolan baru.'],
	closePanel: ['关闭面板', 'Tutup panel'],
	closeLoupe: ['关闭放大镜', 'Tutup kaca pembesar'],
	panelLoupe: ['面板放大镜 — 全尺寸阅读视图', 'Kaca pembesar panel — tampilan baca ukuran penuh'],
	resizePanel: ['调整面板大小', 'Ubah ukuran panel'],
	dragResize: ['拖动调整大小 · Shift+拖动调整全部', 'Seret untuk mengubah ukuran · Shift+seret untuk semua'],
	save: ['保存', 'Simpan'],
	revert: ['还原', 'Kembalikan'],
	revertEdits: ['还原编辑', 'Kembalikan suntingan'],
	sessionIdToOpen: ['要作为面板打开的会话 id', 'ID sesi untuk dibuka sebagai panel'],
	pasteSessionId: ['粘贴会话 id…', 'Tempel ID sesi…'],
	add: ['添加', 'Tambah'],
	openAsPanel: ['作为面板打开', 'Buka sebagai panel'],
	rplc: ['替换', 'Ganti'],
	replaceActivePanel: ['替换活动面板', 'Ganti panel aktif'],
	floorControls: ['面板控制', 'Kontrol lantai'],
	width: ['宽度', 'Lebar'],
	panelWidthAll: ['所有面板的宽度', 'Lebar untuk semua panel'],
	zoom: ['缩放', 'Zoom'],
	floorZoom: ['地面缩放', 'Zoom lantai'],
	copyFloorImage: ['将面板地面复制为图片(Shift+点击保存)', 'Salin lantai panel sebagai gambar (Shift+Klik untuk simpan)'],
	floorCapture: ['地面捕获', 'Tangkapan lantai'],
	closeAbout: ['关闭关于对话框', 'Tutup dialog tentang'],
	aboutDsi: ['关于 Deepseek Insight', 'Tentang Deepseek Insight'],
	aboutTagline: ['洞悉 Deepseek Harness', 'Memperoleh wawasan dari Deepseek Harness'],
	aboutCredit: ['作者:Widi Harsojo (c) 2026 - Apache 许可证', 'Dibuat oleh: Widi Harsojo (c) 2026 - Lisensi Apache'],
	clearFilters: ['清除所有筛选', 'Hapus semua filter'],
	all: ['全部', 'Semua'],
	filterBy: ['筛选', 'Filter menurut'],
	onlyNeverPrompted: ['仅显示从未提示的(空)会话', 'Hanya sesi tanpa prompt (kosong)'],
	onlyWithConversation: ['仅显示至少有一次对话的会话', 'Hanya sesi dengan minimal satu percakapan'],
	onlyEnabledWorkspaces: ['仅显示已注册(启用)工作区的会话', 'Hanya sesi di workspace terdaftar (aktif)'],
	filterCountOrWorkspace: ['按对话数量或工作区筛选', 'Filter menurut jumlah percakapan atau workspace'],
	collapseLineage: ['折叠所有有谱系的会话', 'Ciutkan semua sesi bergaris keturunan'],
	expandLineage: ['展开所有有谱系的会话', 'Bentangkan semua sesi bergaris keturunan'],
	lineageFold: ['谱系折叠', 'Lipatan garis keturunan'],
	sessions: ['会话', 'Sesi'],
	filterBySessionName: ['按会话名称筛选…', 'Filter menurut nama sesi...'],
	filterBySessionNameLabel: ['按会话名称筛选', 'Filter menurut nama sesi'],
	workspaceActions: ['工作区操作', 'Aksi workspace'],
	backToWorkspace: ['← 返回工作区', '← Kembali ke workspace']
};

const catalogs = { en: {}, zh: {}, id: {} };
for (const [k, [en, zh, id]] of Object.entries(C)) {
	catalogs.en[k] = en;
	catalogs.zh[k] = zh;
	catalogs.id[k] = id ?? zh;
}
for (const locale of ['en', 'zh', 'id']) {
	const f = rel('messages/' + locale + '.json');
	const doc = JSON.parse(readFileSync(f, 'utf8'));
	let added = 0;
	for (const [k, v] of Object.entries(catalogs[locale])) {
		if (!(k in doc)) { doc[k] = v; added++; }
	}
	writeFileSync(f, JSON.stringify(doc, null, '\t') + '\n');
	console.log(locale + '.json: +' + added);
}

// ---------- component replacements ----------
// [file, from, to]
const R = [
	['src/lib/components/card/ApprovalCard.svelte', 'Tool approval:', '{m.toolApproval()}'],
	['src/lib/components/chat/AttachmentManager.svelte', 'title="Attach images"', 'title={m.attachImages()}'],
	['src/lib/components/chat/AttachmentManager.svelte', 'aria-label="Attach images"', 'aria-label={m.attachImages()}'],
	['src/lib/components/chat/CommandHelpCard.svelte', 'aria-label="Command help"', 'aria-label={m.commandHelp()}'],
	['src/lib/components/chat/CommandHelpCard.svelte', 'Esc hides this · delete the', '{m.escHidesA()}'],
	['src/lib/components/chat/CommandHelpCard.svelte', 'to keep composing', '{m.escHidesB()}'],
	['src/lib/components/chat/ImageLightbox.svelte', 'aria-label="Close preview"', 'aria-label={m.closePreview()}'],
	['src/lib/components/chat/ImageLightbox.svelte', 'aria-label="Original image preview"', 'aria-label={m.originalImagePreview()}'],
	['src/lib/components/chat/PromptManagerPanel.svelte', '>Del<', '>{m.del()}<'],
	['src/lib/components/chat/PromptManagerPanel.svelte', 'title="Auto-check rows with this many uses (0 = off)"', 'title={m.autoCheckTitle()}'],
	['src/lib/components/chat/PromptManagerPanel.svelte', '☑ Selected', '{m.selectedRows()}'],
	['src/lib/components/chat/PromptManagerPanel.svelte', 'title="Show only selected rows"', 'title={m.showOnlySelected()}'],
	['src/lib/components/chat/PromptManagerPanel.svelte', 'placeholder="Search prompts…"', 'placeholder={m.searchPrompts()}'],
	['src/lib/components/chat/PromptManagerPanel.svelte', 'aria-label="Close"', 'aria-label={m.close()}'],
	['src/lib/components/chat/PromptManagerPanel.svelte', 'aria-label="Prompts manager"', 'aria-label={m.promptsManager()}'],
	['src/lib/components/chat/PromptsManagerDialog.svelte', 'aria-label="Manage saved prompts"', 'aria-label={m.manageSavedPrompts()}'],
	['src/lib/components/chat/SlashMenu.svelte', 'aria-label="Slash menu"', 'aria-label={m.slashMenu()}'],
	['src/lib/components/chat/StickToBottomToggle.svelte', 'aria-label="Stick to bottom"', 'aria-label={m.stickToBottom()}'],
	['src/lib/components/chat/StreamingIndicator.svelte', 'aria-label="streaming"', 'aria-label={m.streaming()}'],
	['src/lib/components/chat/TokenCounter.svelte', 'title="Heuristic estimate (~4 chars/token) of the draft"', 'title={m.tokenCounterTitle()}'],
	['src/lib/components/common/buttons/FilterDateButton.svelte', 'title="Filter by date"', 'title={m.filterByDate()}'],
	['src/lib/components/common/buttons/FilterDateButton.svelte', 'aria-label="Filter sessions by date"', 'aria-label={m.filterSessionsByDate()}'],
	['src/lib/components/common/buttons/ForkHereButton.svelte', 'aria-label="Fork from this turn"', 'aria-label={m.forkFromTurn()}'],
	['src/lib/components/common/buttons/ForkHereButton.svelte', 'title="Fork from this turn — branch a new session ending at this turn"', 'title={m.forkFromTurnLong()}'],
	['src/lib/components/common/layout/AddWorkspaceButton.svelte', 'aria-label="Add workspace"', 'aria-label={m.addWorkspace()}'],
	['src/lib/components/common/layout/AddWorkspaceButton.svelte', 'title="Add workspace"', 'title={m.addWorkspace()}'],
	['src/lib/components/common/layout/CalendarPicker.svelte', 'aria-label="Previous month"', 'aria-label={m.previousMonth()}'],
	['src/lib/components/common/layout/CalendarPicker.svelte', 'aria-label="Next month"', 'aria-label={m.nextMonth()}'],
	['src/lib/components/common/layout/CalendarPicker.svelte', 'aria-label="Date picker"', 'aria-label={m.datePicker()}'],
	['src/lib/components/common/layout/PlanPopup.svelte', 'title="Current Plan ({done}/{items.length} done)"', 'title="{m.currentPlan()}{done}/{items.length}{m.donePart()}"'],
	['src/lib/components/common/layout/UserMessageJumper.svelte', 'title="User Messages ({prompts.length})"', 'title="{m.userMessages()}{prompts.length})"'],
	['src/lib/components/common/viewers/ReasoningContentViewer.svelte', 'title="Copy reasoning"', 'title={m.copyReasoning()}'],
	['src/lib/components/common/viewers/TerminalContentViewer.svelte', 'title="Copy output"', 'title={m.copyOutput()}'],
	['src/lib/components/message/FileContentViewer.svelte', 'title="Copy full path"', 'title={m.copyFullPath()}'],
	['src/lib/components/message/RuntimeContextChip.svelte', '⚙ runtime context ·', '{m.runtimeContext()}'],
	['src/lib/components/message/SystemPromptChip.svelte', 'aria-label="System prompt"', 'aria-label={m.systemPrompt()}'],
	['src/lib/components/message/SystemPromptChip.svelte', '>System prompt<', '>{m.systemPrompt()}<'],
	['src/lib/components/message/ToolPeekButton.svelte', 'title="Peek all tool calls as list"', 'title={m.peekToolCalls()}'],
	['src/lib/components/message/TurnErrorChip.svelte', 'turn failed', '{m.turnFailed()}'],
	['src/lib/components/message/TurnUsagePanel.svelte', '>Usage<', '>{m.usage()}<'],
	['src/lib/components/panels/EmptyFloor.svelte', 'No conversations open.', '{m.noConversations()}'],
	['src/lib/components/panels/EmptyFloor.svelte', 'Pick a session from the sidebar, or start one with + New chat.', '{m.pickSession()}'],
	['src/lib/components/panels/InjectedDocPanel.svelte', 'aria-label="Close panel"', 'aria-label={m.closePanel()}'],
	['src/lib/components/panels/PanelLoupe.svelte', 'aria-label="Close loupe"', 'aria-label={m.closeLoupe()}'],
	['src/lib/components/panels/PanelLoupe.svelte', 'aria-label="Panel loupe — full-size reading view"', 'aria-label={m.panelLoupe()}'],
	['src/lib/components/panels/ResizeGutter.svelte', 'aria-label="Resize panel"', 'aria-label={m.resizePanel()}'],
	['src/lib/components/panels/ResizeGutter.svelte', 'title="Drag to resize · Shift+drag resizes all"', 'title={m.dragResize()}'],
	['src/lib/components/panels/SettingsEditorPanel.svelte', '>Save<', '>{m.save()}<'],
	['src/lib/components/panels/SettingsEditorPanel.svelte', '>Revert<', '>{m.revert()}<'],
	['src/lib/components/panels/SettingsEditorPanel.svelte', 'aria-label="Revert edits"', 'aria-label={m.revertEdits()}'],
	['src/lib/components/panels/SettingsEditorPanel.svelte', 'aria-label="Close panel"', 'aria-label={m.closePanel()}'],
	['src/lib/components/panels/control-bar/AddPanel.svelte', 'aria-label="Session id to open as a panel"', 'aria-label={m.sessionIdToOpen()}'],
	['src/lib/components/panels/control-bar/AddPanel.svelte', 'placeholder="Paste session id…"', 'placeholder={m.pasteSessionId()}'],
	['src/lib/components/panels/control-bar/AddPanel.svelte', '>Add<', '>{m.add()}<'],
	['src/lib/components/panels/control-bar/AddPanel.svelte', 'title="Open as panel"', 'title={m.openAsPanel()}'],
	['src/lib/components/panels/control-bar/AddPanel.svelte', '>Rplc<', '>{m.rplc()}<'],
	['src/lib/components/panels/control-bar/AddPanel.svelte', 'title="Replace active panel"', 'title={m.replaceActivePanel()}'],
	['src/lib/components/panels/control-bar/ControlBar.svelte', 'aria-label="Floor controls"', 'aria-label={m.floorControls()}'],
	['src/lib/components/panels/control-bar/ControlBarTray.svelte', 'aria-label="Floor controls"', 'aria-label={m.floorControls()}'],
	['src/lib/components/panels/control-bar/SliderWidth.svelte', '>Width<', '>{m.width()}<'],
	['src/lib/components/panels/control-bar/SliderWidth.svelte', 'aria-label="Panel width for all panels"', 'aria-label={m.panelWidthAll()}'],
	['src/lib/components/panels/control-bar/SliderZoom.svelte', '>Zoom<', '>{m.zoom()}<'],
	['src/lib/components/panels/control-bar/SliderZoom.svelte', 'aria-label="Floor zoom"', 'aria-label={m.floorZoom()}'],
	['src/lib/components/panels/control-bar/TrayButtons.svelte', 'title="Copy panel floor as image (Shift+Click to save)"', 'title={m.copyFloorImage()}'],
	['src/lib/components/panels/control-bar/TrayButtons.svelte', 'aria-label="Floor capture"', 'aria-label={m.floorCapture()}'],
	['src/lib/components/sessions/AboutDialog.svelte', 'aria-label="Close about dialog"', 'aria-label={m.closeAbout()}'],
	['src/lib/components/sessions/AboutDialog.svelte', 'title="Close"', 'title={m.close()}'],
	['src/lib/components/sessions/AboutDialog.svelte', '>Getting Insight of Deepseek Harness<', '>{m.aboutTagline()}<'],
	['src/lib/components/sessions/AboutDialog.svelte', 'Created by: Widi Harsojo (c) 2026 - Apache License', '{m.aboutCredit()}'],
	['src/lib/components/sessions/AboutDialog.svelte', 'aria-label="About Deepseek Insight"', 'aria-label={m.aboutDsi()}'],
	['src/lib/components/sessions/RowButtonClose.svelte', 'aria-label="Close panel "', 'aria-label={m.closePanel()}'],
	['src/lib/components/sessions/RowButtonClose.svelte', 'title="Close panel"', 'title={m.closePanel()}'],
	['src/lib/components/sessions/SessionFilterClear.svelte', '>All<', '>{m.all()}<'],
	['src/lib/components/sessions/SessionFilterClear.svelte', 'title="Clear every filter"', 'title={m.clearFilters()}'],
	['src/lib/components/sessions/SessionFilterHeader.svelte', 'Filter by', '{m.filterBy()}'],
	['src/lib/components/sessions/SessionFilterToggle.svelte', 'title="Only never-prompted (empty) sessions"', 'title={m.onlyNeverPrompted()}'],
	['src/lib/components/sessions/SessionFilterToggle.svelte', 'title="Only sessions with at least one conversation"', 'title={m.onlyWithConversation()}'],
	['src/lib/components/sessions/SessionFilterToggle.svelte', 'title="Only sessions in registered (enabled) workspaces"', 'title={m.onlyEnabledWorkspaces()}'],
	['src/lib/components/sessions/SessionFilterToggle.svelte', 'aria-label="Filter by conversation count or workspace"', 'aria-label={m.filterCountOrWorkspace()}'],
	['src/lib/components/sessions/SidebarFooter.svelte', 'aria-label="About Deepseek Insight"', 'aria-label={m.aboutDsi()}'],
	['src/lib/components/sessions/SidebarFooter.svelte', 'title="About Deepseek Insight"', 'title={m.aboutDsi()}'],
	['src/lib/components/sessions/SidebarOpenPanelTree.svelte', 'aria-label="Collapse all sessions with lineage"', 'aria-label={m.collapseLineage()}'],
	['src/lib/components/sessions/SidebarOpenPanelTree.svelte', 'title="Collapse all sessions with lineage"', 'title={m.collapseLineage()}'],
	['src/lib/components/sessions/SidebarOpenPanelTree.svelte', 'aria-label="Expand all sessions with lineage"', 'aria-label={m.expandLineage()}'],
	['src/lib/components/sessions/SidebarOpenPanelTree.svelte', 'title="Expand all sessions with lineage"', 'title={m.expandLineage()}'],
	['src/lib/components/sessions/SidebarOpenPanelTree.svelte', 'aria-label="Lineage fold"', 'aria-label={m.lineageFold()}'],
	['src/lib/components/sidebar/session-list/SidebarSessionList.svelte', '>Sessions<', '>{m.sessions()}<'],
	['src/lib/components/sidebar/session-list/SidebarSessionList.svelte', 'placeholder="Filter by session name..."', 'placeholder={m.filterBySessionName()}'],
	['src/lib/components/sidebar/session-list/SidebarSessionList.svelte', 'aria-label="Filter by session name"', 'aria-label={m.filterBySessionNameLabel()}'],
	['src/lib/components/sessions/WorkspaceActionsMenu.svelte', 'aria-label="Workspace actions"', 'aria-label={m.workspaceActions()}'],
	['src/routes/+error.svelte', '← Back to the workspace', '{m.backToWorkspace()}']
];

// brand strings — exempt with an audit-trail marker, never translated
const SKIPS = [
	['src/routes/+page.svelte', 'Workspace — deepseek-insight'],
	['src/routes/+error.svelte', '— deepseek-insight'],
	['src/lib/components/sessions/AboutDialog.svelte', 'DEEPSEEK INSIGHT']
];

const byFile = new Map();
for (const [f, from, to] of R) {
	if (!byFile.has(f)) byFile.set(f, []);
	byFile.get(f).push([from, to]);
}

let applied = 0, missed = [];
for (const [f, pairs] of byFile) {
	const p = rel(f);
	let src = readFileSync(p, 'utf8');
	for (const [from, to] of pairs) {
		if (src.includes(to)) { applied++; continue; } // idempotent re-run
		if (!src.includes(from)) { missed.push(f + ' :: ' + from); continue; }
		src = src.split(from).join(to);
		applied++;
	}
	if (!src.includes("$lib/paraglide/messages'")) {
		const NL = String.fromCharCode(10);
		const lines2 = src.split(NL);
		const open = lines2.findIndex((l) => /^<script[^>]*>$/.test(l.trim()));
		if (open >= 0) {
			lines2.splice(open + 1, 0, String.fromCharCode(9) + "import * as m from '$lib/paraglide/messages';");
			src = lines2.join(NL);
		}
	}	writeFileSync(p, src);
}
for (const [f, marker] of SKIPS) {
	const p = rel(f);
	let src = readFileSync(p, 'utf8');
	const lines = src.split('\n');
	const idx = lines.findIndex((l) => l.includes(marker));
	if (idx >= 0 && !lines[idx - 1].includes('i18n-skip')) {
		const indent = lines[idx].match(/^\s*/)[0];
		lines.splice(idx, 0, indent + '<!-- i18n-skip: brand, never translated -->');
		writeFileSync(p, lines.join('\n'));
	}
}
console.log('applied:', applied, 'missed:', missed.length);
for (const m of missed) console.log('  MISS ' + m);
