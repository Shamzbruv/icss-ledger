/**
 * Renders Client Care reports (weekly, monthly) and admin alerts as email-safe HTML + plain text.
 *
 * Email-client rules followed here: table layout, inline CSS only, no flex/grid/absolute/blur,
 * 16px body text, status shown with a symbol AND words (never colour alone), and a plain-text
 * alternative that carries the same information.
 */
const { fmt, GROUPS } = require('./careExplainers');
const { COMPANY_PHONE } = require('../contractTemplate');

const SUPPORT_EMAIL = 'support@icreatesolutionsandservices.com';
const FONT = "'Segoe UI',Arial,Helvetica,sans-serif";

const COLORS = {
    ink: '#1f2933', muted: '#5f6b7a', line: '#e3e8ef', page: '#f3f5f8', card: '#ffffff', navy: '#0b2a4a', brand: '#0056b3',
    good: { fg: '#146c2e', bg: '#e8f5ec', bd: '#b7e0c2', solid: '#1a7f37' },
    warn: { fg: '#7a4f00', bg: '#fff6e0', bd: '#f2d38b', solid: '#c98a00' },
    bad: { fg: '#a4202a', bg: '#fdecee', bd: '#f3b6bc', solid: '#cf222e' },
    info: { fg: '#0b5cad', bg: '#eaf3fd', bd: '#b9d6f5', solid: '#2f6fed' },
    muted2: { fg: '#5f6b7a', bg: '#f1f3f6', bd: '#dde2e8', solid: '#8a94a3' }
};

const TONE_COLOR = { great: 'good', good: 'good', attention: 'warn', critical: 'bad', info: 'info' };
const STATE_COLOR = { pass: 'good', good: 'good', warn: 'warn', fail: 'bad', bad: 'bad', info: 'info', skip: 'muted2' };
const GLYPH = { good: '✓', warn: '!', bad: '✕', info: 'i', muted2: '–' };

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const inline = value => esc(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
const plain = value => String(value ?? '').replace(/\*\*(.+?)\*\*/g, '$1');

// -----------------------------------------------------------------------------
// Building blocks
// -----------------------------------------------------------------------------
function badge(colorKey, size = 28) {
    const c = COLORS[colorKey] || COLORS.muted2;
    return `<td width="${size}" valign="top" style="width:${size}px;padding-top:2px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" valign="middle" width="${size}" height="${size}" style="width:${size}px;height:${size}px;border-radius:${size / 2}px;background:${c.bg};border:1px solid ${c.bd};color:${c.fg};font-family:${FONT};font-size:${Math.round(size * 0.56)}px;font-weight:bold;line-height:${size}px;text-align:center;">${GLYPH[colorKey] || '•'}</td></tr></table></td>`;
}

function card(innerHtml, { border = COLORS.line, bg = COLORS.card, accent = null, pad = 20 } = {}) {
    const left = accent ? `border-left:5px solid ${accent};` : '';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;"><tr><td style="background:${bg};border:1px solid ${border};${left}border-radius:12px;padding:${pad}px;font-family:${FONT};color:${COLORS.ink};">${innerHtml}</td></tr></table>`;
}

function sectionTitle(text, sub) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:10px 4px 8px 4px;font-family:${FONT};"><div style="font-size:21px;line-height:1.3;font-weight:bold;color:${COLORS.navy};">${esc(text)}</div>${sub ? `<div style="font-size:15px;line-height:1.5;color:${COLORS.muted};padding-top:2px;">${inline(sub)}</div>` : ''}</td></tr></table>`;
}

function p(text, { size = 16, color = COLORS.ink, bold = false, top = 0, bottom = 8 } = {}) {
    return `<div style="font-family:${FONT};font-size:${size}px;line-height:1.55;color:${color};${bold ? 'font-weight:bold;' : ''}margin:${top}px 0 ${bottom}px 0;">${inline(text)}</div>`;
}

function bar(percent, colorKey = 'info') {
    const width = Math.max(2, Math.min(100, Math.round(percent || 0)));
    const c = COLORS[colorKey] || COLORS.info;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="${width}%" bgcolor="${c.solid}" style="background:${c.solid};height:9px;line-height:9px;font-size:0;border-radius:5px;">&nbsp;</td><td style="font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
}

function barRows(rows, { colorKey = 'info', valueText }) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.map(r => `
        <tr><td style="font-family:${FONT};font-size:15px;line-height:1.4;color:${COLORS.ink};padding:8px 0 3px 0;">${inline(r.label)}${r.sub ? `<span style="color:${COLORS.muted};font-size:13px;"> &nbsp;${esc(r.sub)}</span>` : ''}</td><td align="right" style="font-family:${FONT};font-size:15px;font-weight:bold;color:${COLORS.ink};padding:8px 0 3px 8px;white-space:nowrap;">${esc(valueText(r))}</td></tr>
        <tr><td colspan="2" style="padding:0 0 4px 0;">${bar(r.percent, colorKey)}</td></tr>`).join('')}</table>`;
}

function button(label, href) {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 0 0;"><tr><td align="center" bgcolor="${COLORS.brand}" style="background:${COLORS.brand};border-radius:8px;"><a href="${esc(href)}" style="display:inline-block;padding:13px 24px;font-family:${FONT};font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;">${esc(label)}</a></td></tr></table>`;
}

function replyLink(subject) { return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`; }

function layout({ title, preheader, body, footerNote }) {
    const year = new Date().getFullYear();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${COLORS.page};font-size:1px;line-height:1px;">${esc(preheader || '')}${'&nbsp;&zwnj;'.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.page};">
<tr><td align="center" style="padding:20px 10px 30px 10px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;">
<tr><td style="background:${COLORS.navy};border-radius:12px 12px 0 0;padding:20px 24px;font-family:${FONT};">
  <div style="font-size:19px;font-weight:bold;color:#ffffff;letter-spacing:0.2px;">iCreate Solutions &amp; Services</div>
  <div style="font-size:14px;color:#b9c9dc;padding-top:3px;">${esc(title)}</div>
</td></tr>
<tr><td style="background:${COLORS.page};padding:16px 0 0 0;">
${body}
</td></tr>
<tr><td style="padding:8px 4px 0 4px;font-family:${FONT};font-size:13px;line-height:1.6;color:${COLORS.muted};text-align:center;">
  ${footerNote || ''}
  <div style="padding-top:6px;">&copy; ${year} iCreate Solutions &amp; Services</div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// -----------------------------------------------------------------------------
// Weekly report sections
// -----------------------------------------------------------------------------
function heroSection(m) {
    const colorKey = TONE_COLOR[m.health.tone] || 'info';
    const c = COLORS[colorKey];
    const period = m.meta.periodStart && m.meta.periodEnd ? `${fmt.dayMonth(m.meta.periodStart)} – ${fmt.date(m.meta.periodEnd)}` : fmt.date(m.meta.generatedAt);
    const tiles = m.scoreboard.slice(0, 4).map(t => {
        const tc = COLORS[STATE_COLOR[t.state] || 'info'];
        return `<td width="${Math.floor(100 / Math.max(m.scoreboard.length, 1))}%" align="center" valign="top" style="padding:0 4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="background:#ffffff;border:1px solid ${COLORS.line};border-top:4px solid ${tc.solid};border-radius:8px;padding:10px 4px;font-family:${FONT};">
            <div style="font-size:12px;letter-spacing:0.6px;text-transform:uppercase;color:${COLORS.muted};">${esc(t.label)}</div>
            <div style="font-size:19px;font-weight:bold;color:${tc.fg};padding-top:3px;">${esc(t.value)}</div>
            <div style="font-size:12px;color:${COLORS.muted};padding-top:1px;">${esc(t.sub || ' ')}</div>
        </td></tr></table></td>`;
    }).join('');

    const websiteLine = m.meta.host
        ? `Here is this week's report for <strong>${esc(m.meta.host)}</strong>, part of your <strong>${esc(m.meta.planName)}</strong> plan.`
        : `Here is this week's report for your <strong>${esc(m.meta.planName)}</strong> plan.`;

    const todoColor = COLORS[TONE_COLOR[m.todo?.tone] || 'info'];
    return card(`
        <div style="font-family:${FONT};font-size:18px;line-height:1.5;padding-bottom:4px;">Hello ${esc(m.meta.greeting)},</div>
        <div style="font-family:${FONT};font-size:16px;line-height:1.55;color:${COLORS.ink};padding-bottom:14px;">${websiteLine} <span style="color:${COLORS.muted};">(${esc(period)})</span></div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px;"><tr>
          <td style="background:${c.bg};border:1px solid ${c.bd};border-left:6px solid ${c.solid};border-radius:10px;padding:16px;font-family:${FONT};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              <td valign="top" style="font-family:${FONT};">
                <div style="font-size:23px;line-height:1.3;font-weight:bold;color:${c.fg};">${esc(m.health.headline)}</div>
                ${m.health.subline ? `<div style="font-size:16px;line-height:1.5;color:${c.fg};padding-top:6px;">${esc(m.health.subline)}</div>` : ''}
              </td>
              <td valign="top" align="center" width="92" style="width:92px;padding-left:12px;font-family:${FONT};">
                <div style="font-size:34px;line-height:1;font-weight:bold;color:${c.fg};">${esc(m.health.score)}</div>
                <div style="font-size:12px;color:${c.fg};padding-top:2px;">out of 100</div>
                <div style="font-size:13px;font-weight:bold;color:${c.fg};padding-top:3px;">${esc(m.health.label)}</div>
              </td>
            </tr></table>
          </td></tr></table>
        ${m.scoreboard.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px 0;"><tr>${tiles}</tr></table>` : ''}
        ${m.trackRecord ? `<div style="font-family:${FONT};font-size:15px;line-height:1.5;color:${COLORS.good.fg};padding:0 2px 12px 2px;"><strong>✓</strong> ${esc(m.trackRecord.text)}</div>` : ''}
        ${m.todo ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:${todoColor.bg};border:1px solid ${todoColor.bd};border-radius:10px;padding:14px 16px;font-family:${FONT};">
            <div style="font-size:16px;font-weight:bold;color:${todoColor.fg};padding-bottom:3px;">${esc(m.todo.title)}</div>
            <div style="font-size:16px;line-height:1.55;color:${COLORS.ink};">${inline(m.todo.body)}</div>
        </td></tr></table>` : ''}
        <div style="font-family:${FONT};font-size:13px;line-height:1.6;color:${COLORS.muted};padding-top:12px;">How to read this email: <strong style="color:${COLORS.good.fg};">✓</strong> all good &nbsp; <strong style="color:${COLORS.warn.fg};">!</strong> worth a look &nbsp; <strong style="color:${COLORS.bad.fg};">✕</strong> needs attention &nbsp; <strong style="color:${COLORS.info.fg};">i</strong> good to know</div>
    `);
}

function adminNotesSection(m) {
    if (!m.adminNotes?.length) return '';
    const rows = m.adminNotes.map(n => {
        const c = COLORS[n.level === 'action' ? 'bad' : 'info'];
        return `<div style="padding:10px 0;border-top:1px solid ${c.bd};">
            <div style="font-family:${FONT};font-size:15px;font-weight:bold;color:${c.fg};">${esc(n.title)}</div>
            <div style="font-family:${FONT};font-size:14px;line-height:1.55;color:${COLORS.ink};padding-top:2px;">${inline(n.body || '')}</div>
            ${n.serviceAccountEmail ? `<div style="font-family:${FONT};font-size:14px;color:${COLORS.ink};padding-top:4px;">Reporting account: <strong>${esc(n.serviceAccountEmail)}</strong></div>` : ''}
            ${(n.steps || []).length ? `<ol style="margin:6px 0 0 18px;padding:0;font-family:${FONT};font-size:14px;line-height:1.55;color:${COLORS.ink};">${n.steps.map(s => `<li style="margin-bottom:3px;">${inline(s)}</li>`).join('')}</ol>` : ''}
        </div>`;
    }).join('');
    return card(`<div style="font-family:${FONT};font-size:13px;letter-spacing:0.6px;text-transform:uppercase;font-weight:bold;color:${COLORS.bad.fg};">For the iCreate team only — the client does not see this box</div>${rows}`, { border: COLORS.bad.bd, bg: '#fffafa', accent: COLORS.bad.solid });
}

function attentionCard(item) {
    const key = STATE_COLOR[item.status] || 'warn';
    const c = COLORS[key];
    return card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${badge(key, 30)}<td style="padding-left:12px;font-family:${FONT};">
        <div style="font-size:13px;letter-spacing:0.4px;text-transform:uppercase;color:${COLORS.muted};">${esc(item.title)}</div>
        <div style="font-size:18px;line-height:1.4;font-weight:bold;color:${c.fg};padding:2px 0 6px 0;">${esc(item.headline)}</div>
        ${item.detail ? `<div style="font-size:16px;line-height:1.55;padding-bottom:6px;">${inline(item.detail)}</div>` : ''}
        ${item.meaning ? `<div style="font-size:16px;line-height:1.55;padding-bottom:6px;"><strong>What this means:</strong> ${inline(item.meaning)}</div>` : ''}
        ${item.action ? `<div style="font-size:16px;line-height:1.55;"><strong>What happens next:</strong> ${inline(item.action)}</div>` : ''}
    </td></tr></table>`, { border: c.bd, bg: '#ffffff', accent: c.solid });
}

function attentionSection(m) {
    if (!m.attention.length) return '';
    const urgent = m.attention.some(a => a.critical);
    return sectionTitle(m.attention.length === 1 ? 'One thing to look at' : `${m.attention.length} things to look at`, urgent ? 'The first one matters most. Each item says what happens next.' : 'Nothing here is unusual for a busy website, but each one is worth knowing about.')
        + m.attention.map(attentionCard).join('');
}

function visitorsSection(m) {
    const a = m.analytics;
    if (!a || a.state === 'hidden') return '';
    const title = 'Your visitors this week';

    if (a.state === 'connecting' || a.state === 'unavailable') {
        return sectionTitle(title) + card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${badge('info', 30)}<td style="padding-left:12px;font-family:${FONT};"><div style="font-size:18px;font-weight:bold;line-height:1.4;padding-bottom:4px;">${esc(a.headline)}</div><div style="font-size:16px;line-height:1.55;">${esc(a.body)}</div></td></tr></table>`, { border: COLORS.info.bd, bg: COLORS.info.bg });
    }
    if (a.state === 'not-installed') {
        return sectionTitle(title) + card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${badge('warn', 30)}<td style="padding-left:12px;font-family:${FONT};"><div style="font-size:18px;font-weight:bold;line-height:1.4;padding-bottom:4px;">${esc(a.headline)}</div><div style="font-size:16px;line-height:1.55;padding-bottom:8px;">${esc(a.body)}</div><div style="font-size:16px;line-height:1.55;"><strong>What happens next:</strong> ${esc(a.action)}</div></td></tr></table>`, { border: COLORS.warn.bd, bg: COLORS.warn.bg, accent: COLORS.warn.solid });
    }

    const tiles = a.tiles.map(t => {
        const dir = t.change.dir;
        const color = dir === 'up' ? COLORS.good.fg : dir === 'down' ? COLORS.warn.fg : COLORS.muted;
        const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '•';
        return `<td width="33%" align="center" valign="top" style="padding:0 4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="background:${COLORS.info.bg};border:1px solid ${COLORS.info.bd};border-radius:10px;padding:12px 4px;font-family:${FONT};">
            <div style="font-size:32px;line-height:1.1;font-weight:bold;color:${COLORS.navy};">${esc(t.value)}</div>
            <div style="font-size:14px;color:${COLORS.ink};padding-top:3px;">${esc(t.label)}</div>
            <div style="font-size:12px;line-height:1.4;color:${color};padding-top:4px;">${arrow} ${esc(t.change.short)}</div>
        </td></tr></table></td>`;
    }).join('');

    const lists = [];
    if (a.topPages?.length) {
        const max = Math.max(...a.topPages.map(x => x.views), 1);
        lists.push(`<div style="font-family:${FONT};font-size:16px;font-weight:bold;color:${COLORS.navy};padding:14px 0 0 0;">Your most-viewed pages</div>` + barRows(a.topPages.map(x => ({ label: x.name, sub: x.path !== '/' ? x.path : '', percent: (x.views / max) * 100, views: x.views, share: x.share })), { valueText: r => `${fmt.number(r.views)} ${r.views === 1 ? 'view' : 'views'}` }));
    }
    if (a.channels?.length) {
        const max = Math.max(...a.channels.map(x => x.sessions), 1);
        lists.push(`<div style="font-family:${FONT};font-size:16px;font-weight:bold;color:${COLORS.navy};padding:14px 0 0 0;">How people found you</div>` + barRows(a.channels.map(x => ({ label: x.name, percent: (x.sessions / max) * 100, share: x.share })), { colorKey: 'good', valueText: r => `${r.share}%` }));
    }
    if (a.devices?.length) {
        lists.push(`<div style="font-family:${FONT};font-size:16px;font-weight:bold;color:${COLORS.navy};padding:14px 0 0 0;">What visitors used</div>` + barRows(a.devices.map(x => ({ label: x.name, percent: x.share, share: x.share })), { colorKey: 'warn', valueText: r => `${r.share}%` }));
    }
    if (a.countries?.length) {
        lists.push(`<div style="font-family:${FONT};font-size:16px;font-weight:bold;color:${COLORS.navy};padding:14px 0 0 0;">Where visitors were</div>` + barRows(a.countries.map(x => ({ label: x.name, percent: x.share, share: x.share })), { colorKey: 'info', valueText: r => `${r.share}%` }));
    }
    if (a.daily?.length) {
        lists.push(`<div style="font-family:${FONT};font-size:16px;font-weight:bold;color:${COLORS.navy};padding:14px 0 0 0;">Day by day</div>` + barRows(a.daily.map(x => ({ label: x.label, percent: x.bar, sessions: x.sessions })), { colorKey: 'info', valueText: r => `${fmt.number(r.sessions)} ${r.sessions === 1 ? 'visit' : 'visits'}` }));
    }

    const insights = a.insights?.length
        ? `<div style="font-family:${FONT};font-size:16px;font-weight:bold;color:${COLORS.navy};padding:16px 0 4px 0;">What this tells us</div><ul style="margin:0 0 0 20px;padding:0;font-family:${FONT};font-size:16px;line-height:1.55;">${a.insights.map(i => `<li style="margin-bottom:6px;">${inline(i)}</li>`).join('')}</ul>`
        : '';

    return sectionTitle(title, a.legacy ? null : null) + card(`
        <div style="font-family:${FONT};font-size:19px;line-height:1.4;font-weight:bold;color:${COLORS.navy};padding-bottom:4px;">${esc(a.headline)}</div>
        <div style="font-family:${FONT};font-size:16px;line-height:1.55;padding-bottom:12px;">${esc(a.summary)}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;"><tr>${tiles}</tr></table>
        ${lists.join('')}
        ${insights}
        <div style="font-family:${FONT};font-size:13px;line-height:1.5;color:${COLORS.muted};padding-top:14px;">Figures are for the last 7 full days (${esc(fmt.dayMonth(a.period?.current?.startDate))} – ${esc(fmt.dayMonth(a.period?.current?.endDate))}), straight from your Google Analytics.</div>
    `);
}

function pageSection(m) {
    const pg = m.page;
    if (!pg) return '';
    const blocks = [];

    if (pg.google) {
        const g = pg.google;
        blocks.push(`
        <div style="font-family:${FONT};font-size:16px;font-weight:bold;color:${COLORS.navy};padding-bottom:6px;">How your website looks on Google</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#ffffff;border:1px solid #dfe1e5;border-radius:10px;padding:14px 16px;font-family:Arial,Helvetica,sans-serif;">
            <div style="font-size:14px;color:#202124;line-height:1.4;">${esc(g.displayUrl)}</div>
            <div style="font-size:20px;color:#1a0dab;line-height:1.3;padding:3px 0 4px 0;">${esc(g.title)}</div>
            <div style="font-size:14px;color:#4d5156;line-height:1.57;">${g.description ? esc(g.description) : '<em>(no description — Google picks its own text)</em>'}</div>
        </td></tr></table>
        ${g.notes.length ? `<ul style="margin:8px 0 0 20px;padding:0;font-family:${FONT};font-size:15px;line-height:1.55;">${g.notes.map(n => `<li style="margin-bottom:4px;">${esc(n)}</li>`).join('')}</ul>` : `<div style="font-family:${FONT};font-size:15px;line-height:1.55;padding-top:8px;color:${COLORS.good.fg};">✓ Your title and description are a good length for Google.</div>`}`);
    }

    if (pg.glance?.length) {
        blocks.push(`<div style="font-family:${FONT};font-size:16px;font-weight:bold;color:${COLORS.navy};padding:18px 0 4px 0;">Your homepage at a glance</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${pg.glance.map(r => {
            const key = STATE_COLOR[r.state] || 'muted2';
            return `<tr><td valign="top" style="padding:8px 0;border-bottom:1px solid ${COLORS.line};font-family:${FONT};font-size:15px;color:${COLORS.muted};width:38%;">${esc(r.label)}</td><td valign="top" style="padding:8px 0 8px 8px;border-bottom:1px solid ${COLORS.line};font-family:${FONT};font-size:15px;line-height:1.5;"><strong style="color:${r.state === 'info' || !r.state ? COLORS.ink : COLORS[key].fg};">${esc(r.value)}</strong>${r.note ? `<div style="font-size:13px;color:${COLORS.muted};">${esc(r.note)}</div>` : ''}</td></tr>`;
        }).join('')}</table>`);
    }

    if (pg.contact) {
        blocks.push(`<div style="font-family:${FONT};font-size:16px;font-weight:bold;color:${COLORS.navy};padding:18px 0 4px 0;">Can visitors easily reach you?</div>
        <div style="font-family:${FONT};font-size:15px;line-height:1.55;padding-bottom:6px;">${esc(pg.contact.summary)}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${pg.contact.rows.map(r => `<tr><td width="26" valign="top" style="padding:5px 0;font-family:${FONT};font-size:16px;font-weight:bold;color:${r.ok ? COLORS.good.fg : COLORS.muted};">${r.ok ? '✓' : '–'}</td><td style="padding:5px 0;font-family:${FONT};font-size:15px;line-height:1.5;color:${r.ok ? COLORS.ink : COLORS.muted};">${esc(r.label)}${r.note ? `<span style="color:${COLORS.muted};"> — ${esc(r.note)}</span>` : ''}</td></tr>`).join('')}</table>`);
    }

    if (pg.technical?.length) {
        blocks.push(`<div style="font-family:${FONT};font-size:16px;font-weight:bold;color:${COLORS.navy};padding:18px 0 4px 0;">Behind the scenes</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${pg.technical.map(r => `<tr><td valign="top" style="padding:8px 0;border-bottom:1px solid ${COLORS.line};font-family:${FONT};font-size:15px;color:${COLORS.muted};width:38%;">${esc(r.label)}</td><td valign="top" style="padding:8px 0 8px 8px;border-bottom:1px solid ${COLORS.line};font-family:${FONT};font-size:15px;line-height:1.5;"><strong style="color:${COLORS[STATE_COLOR[r.state] || 'muted2'].fg};">${esc(r.value)}</strong></td></tr>`).join('')}</table>`);
    }

    if (pg.pages?.length) {
        blocks.push(`<div style="font-family:${FONT};font-size:16px;font-weight:bold;color:${COLORS.navy};padding:18px 0 4px 0;">Page by page</div>
        <div style="font-family:${FONT};font-size:14px;color:${COLORS.muted};padding-bottom:6px;">We opened ${pg.pages.length} of your pages${pg.pagesSampledFrom === 'sitemap' ? ' (picked from your sitemap)' : ''} and looked at each one.</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${pg.pages.map(r => `<tr><td width="26" valign="top" style="padding:7px 0;border-bottom:1px solid ${COLORS.line};font-family:${FONT};font-size:16px;font-weight:bold;color:${r.ok ? COLORS.good.fg : COLORS.warn.fg};">${r.ok ? '✓' : '!'}</td><td valign="top" style="padding:7px 0;border-bottom:1px solid ${COLORS.line};font-family:${FONT};font-size:15px;line-height:1.45;"><strong>${esc(r.name)}</strong> <span style="color:${COLORS.muted};font-size:13px;">${esc(r.path)}</span>${r.notes.length ? `<div style="font-size:14px;color:${COLORS.warn.fg};">${esc(r.notes.join(' · '))}</div>` : `<div style="font-size:14px;color:${COLORS.muted};">Looks complete</div>`}</td><td align="right" valign="top" style="padding:7px 0 7px 8px;border-bottom:1px solid ${COLORS.line};font-family:${FONT};font-size:14px;color:${COLORS.muted};white-space:nowrap;">${r.loadMs ? esc(fmt.seconds(r.loadMs)) : ''}</td></tr>`).join('')}</table>
        ${pg.freshness ? `<div style="font-family:${FONT};font-size:15px;line-height:1.55;padding-top:10px;"><strong>Freshness:</strong> the newest update we can see on your site was ${esc(pg.freshness.text)}.</div>` : ''}`);
    }

    // (Ideas that come from what we saw on the page are listed once, under "Optional suggestions".)
    if (!blocks.length) return '';
    return sectionTitle('A closer look at your website', `This is what your homepage looks like to Google and to visitors.`) + card(blocks.join(''));
}

function goodSection(m, compact = false) {
    if (!m.good.length) return '';
    const rows = [];
    GROUPS.forEach(group => {
        const items = m.good.filter(i => i.group === group.id);
        if (!items.length) return;
        rows.push(`<tr><td colspan="2" style="padding:14px 0 4px 0;font-family:${FONT};font-size:13px;letter-spacing:0.6px;text-transform:uppercase;color:${COLORS.muted};font-weight:bold;">${esc(group.title)}</td></tr>`);
        items.forEach(i => rows.push(`<tr>${badge('good', 26)}<td style="padding:6px 0 8px 10px;border-bottom:1px solid ${COLORS.line};font-family:${FONT};">
            <div style="font-size:16px;line-height:1.45;font-weight:bold;">${esc(i.headline)}</div>
            ${i.detail && !compact ? `<div style="font-size:15px;line-height:1.55;color:${COLORS.muted};padding-top:2px;">${inline(i.detail)}</div>` : ''}
        </td></tr>`));
    });
    return sectionTitle('What we checked and found in good shape', `${m.good.length === 1 ? 'This check' : `These ${m.good.length} checks`} came back fine this week.`) + card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join('')}</table>`, { pad: 14 });
}

function fyiSection(m) {
    if (!m.fyi.length) return '';
    const rows = m.fyi.map(i => `<tr>${badge(i.status === 'skip' ? 'muted2' : 'info', 26)}<td style="padding:6px 0 8px 10px;border-bottom:1px solid ${COLORS.line};font-family:${FONT};">
        <div style="font-size:16px;line-height:1.45;font-weight:bold;">${esc(i.headline)}</div>
        ${i.detail ? `<div style="font-size:15px;line-height:1.55;color:${COLORS.muted};padding-top:2px;">${inline(i.detail)}</div>` : ''}
        ${i.meaning ? `<div style="font-size:15px;line-height:1.55;color:${COLORS.muted};padding-top:2px;">${inline(i.meaning)}</div>` : ''}
    </td></tr>`).join('');
    return sectionTitle('Good to know') + card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`, { pad: 14 });
}

function changesSection(m) {
    const c = m.changes;
    if (!c || (!c.fixed.length && !c.worse.length && c.previousScore === null)) return '';
    const lines = [];
    if (c.previousScore !== null) {
        const delta = m.health.score - c.previousScore;
        lines.push(`Your health score is <strong>${m.health.score}</strong> this week, ${delta === 0 ? 'the same as' : delta > 0 ? `up ${delta} from` : `down ${Math.abs(delta)} from`} <strong>${c.previousScore}</strong> last time.`);
    }
    if (c.fixed.length) lines.push(`<span style="color:${COLORS.good.fg};font-weight:bold;">✓ Improved since last time:</span> ${esc(fmt.list(c.fixed))}.`);
    if (c.worse.length) lines.push(`<span style="color:${COLORS.warn.fg};font-weight:bold;">! Newly flagged:</span> ${esc(fmt.list(c.worse))}.`);
    if (!lines.length) return '';
    return sectionTitle('What changed since last time') + card(lines.map(l => `<div style="font-family:${FONT};font-size:16px;line-height:1.55;padding:3px 0;">${l}</div>`).join(''));
}

function recommendationsSection(m) {
    const list = m.ideas || m.recommendations;
    if (!list.length) return '';
    return sectionTitle(m.ideas ? 'Optional suggestions' : 'Our suggestions for you', 'Nothing here is a problem. If you would like us to go ahead with any of them, just reply and tell us which.')
        + card(list.map((r, i) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${i ? `border-top:1px solid ${COLORS.line};` : ''}"><tr>
            <td width="34" valign="top" style="padding:12px 0;font-family:${FONT};"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" valign="middle" width="26" height="26" style="width:26px;height:26px;border-radius:13px;background:${COLORS.navy};color:#ffffff;font-family:${FONT};font-size:14px;font-weight:bold;line-height:26px;">${i + 1}</td></tr></table></td>
            <td style="padding:12px 0;font-family:${FONT};">
              <div style="font-size:16px;line-height:1.45;font-weight:bold;">${esc(r.title)}</div>
              ${r.why ? `<div style="font-size:15px;line-height:1.55;color:${COLORS.muted};padding-top:2px;">${inline(r.why)}</div>` : ''}
              ${r.how ? `<div style="font-size:15px;line-height:1.55;padding-top:3px;">${inline(r.how)}</div>` : ''}
            </td></tr></table>`).join(''), { pad: 8 });
}

function planSection(m) {
    const pl = m.plan;
    const checked = [...(pl.checkedNames || []).slice(0, 14), ...(m.analytics && m.analytics.state !== 'hidden' ? ['Visitor statistics'] : [])];
    const left = checked.length
        ? `<div style="font-family:${FONT};font-size:16px;font-weight:bold;color:${COLORS.navy};padding-bottom:4px;">Checked for you every week</div>
        <ul style="margin:0 0 0 20px;padding:0;font-family:${FONT};font-size:15px;line-height:1.55;">${checked.map(n => `<li style="margin-bottom:3px;">${esc(n)}</li>`).join('')}</ul>`
        : '';
    const right = pl.handledByUs?.length ? `<div style="font-family:${FONT};font-size:16px;font-weight:bold;color:${COLORS.navy};padding:14px 0 4px 0;">Also included in your plan</div>
        <ul style="margin:0 0 0 20px;padding:0;font-family:${FONT};font-size:15px;line-height:1.55;">${pl.handledByUs.map(n => `<li style="margin-bottom:3px;">${esc(n)}</li>`).join('')}</ul>` : '';
    const step = pl.stepUp ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr><td style="background:${COLORS.page};border:1px dashed ${COLORS.line};border-radius:10px;padding:12px 14px;font-family:${FONT};font-size:15px;line-height:1.55;">
        <strong>Want even more?</strong> Our <strong>${esc(pl.stepUp.to)}</strong> plan adds: ${esc(pl.stepUp.adds.join('; '))}. Reply to this email if you would like to hear more — there is no pressure at all.</td></tr></table>` : '';
    return sectionTitle(`What your ${pl.name} plan covers`, pl.promise) + card(left + right + step);
}

function glossarySection(m, compact = false) {
    if (!m.glossary?.length) return '';
    return sectionTitle('Words we used') + card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${m.glossary.slice(0, compact ? 6 : 10).map(g => `<tr><td style="padding:6px 0;border-bottom:1px solid ${COLORS.line};font-family:${FONT};font-size:15px;line-height:1.55;"><strong>${esc(g.term)}</strong> — ${esc(g.meaning)}</td></tr>`).join('')}</table>`, { pad: 14 });
}

function helpSection(m) {
    return card(`<div style="font-family:${FONT};font-size:19px;font-weight:bold;color:${COLORS.navy};padding-bottom:4px;">Questions? Just reply.</div>
        <div style="font-family:${FONT};font-size:16px;line-height:1.55;padding-bottom:8px;">A real person reads every reply. You can also call or WhatsApp us on ${esc(COMPANY_PHONE)}.</div>
        ${button('Reply to this email', replyLink(`About my ${m.meta?.planName || 'website'} report`))}`, { bg: COLORS.info.bg, border: COLORS.info.bd });
}

// Gmail cuts messages off at about 102 KB. Stay well under it by trimming the least important
// detail (the one-line explanations under items that were found fine) when a report is large.
const GMAIL_SAFE_BYTES = 90 * 1024;

function renderWeeklyHtml(m, { compact = false } = {}) {
    const body = [
        m.audience === 'admin' ? adminNotesSection(m) : '',
        heroSection(m),
        attentionSection(m),
        visitorsSection(m),
        pageSection(m),
        changesSection(m),
        recommendationsSection(m),
        goodSection(m, compact),
        fyiSection(m),
        planSection(m),
        glossarySection(m, compact),
        helpSection(m)
    ].join('\n');
    const footerNote = `You are receiving this because ${esc(m.meta.planName)} includes a regular website report. This report was generated automatically on ${esc(fmt.date(m.meta.generatedAt))} from live checks of your website${m.meta.host ? ` (${esc(m.meta.host)})` : ''}.`;
    const html = layout({ title: m.kind === 'weekly' ? 'Your weekly website report' : 'Your monthly website review', preheader: m.preheader, body, footerNote });
    return !compact && Buffer.byteLength(html) > GMAIL_SAFE_BYTES ? renderWeeklyHtml(m, { compact: true }) : html;
}

// -----------------------------------------------------------------------------
// Weekly report: plain text
// -----------------------------------------------------------------------------
function rule(text) { return `${text}\n${'-'.repeat(Math.min(text.length, 60))}`; }

function renderWeeklyText(m) {
    const out = [];
    out.push(`Hello ${m.meta.greeting},`, '');
    out.push(`Here is this week's report for ${m.meta.host || 'your website'}, part of your ${m.meta.planName} plan.`, '');
    out.push(`${m.health.headline}`);
    if (m.health.subline) out.push(m.health.subline);
    out.push(`Health score: ${m.health.score}/100 (${m.health.label})`, '');
    if (m.todo) out.push(`${m.todo.title}`, plain(m.todo.body), '');

    if (m.audience === 'admin' && m.adminNotes?.length) {
        out.push(rule('FOR THE ICREATE TEAM ONLY'));
        m.adminNotes.forEach(n => {
            out.push(`* ${n.title}`, `  ${plain(n.body || '')}`);
            if (n.serviceAccountEmail) out.push(`  Reporting account: ${n.serviceAccountEmail}`);
            (n.steps || []).forEach((s, i) => out.push(`  ${i + 1}. ${plain(s)}`));
        });
        out.push('');
    }

    if (m.attention.length) {
        out.push(rule('THINGS TO LOOK AT'));
        m.attention.forEach(i => {
            out.push(`[${i.status === 'fail' ? 'NEEDS ATTENTION' : 'WORTH A LOOK'}] ${i.headline}`);
            if (i.detail) out.push(`  ${plain(i.detail)}`);
            if (i.meaning) out.push(`  What this means: ${plain(i.meaning)}`);
            if (i.action) out.push(`  What happens next: ${plain(i.action)}`);
            out.push('');
        });
    }

    const a = m.analytics;
    if (a && a.state !== 'hidden') {
        out.push(rule('YOUR VISITORS THIS WEEK'));
        if (a.state === 'ok') {
            out.push(a.headline, a.summary);
            a.tiles.forEach(t => out.push(`  ${t.label}: ${t.value} (${t.change.short})`));
            if (a.topPages?.length) { out.push('', 'Most-viewed pages:'); a.topPages.forEach(x => out.push(`  - ${x.name}: ${fmt.plural(x.views, 'view')}`)); }
            if (a.channels?.length) { out.push('', 'How people found you:'); a.channels.forEach(x => out.push(`  - ${x.name}: ${x.share}%`)); }
            if (a.devices?.length) { out.push('', 'What visitors used:'); a.devices.forEach(x => out.push(`  - ${x.name}: ${x.share}%`)); }
            if (a.countries?.length) { out.push('', 'Where visitors were:'); a.countries.forEach(x => out.push(`  - ${x.name}: ${x.share}%`)); }
            if (a.daily?.length) { out.push('', 'Day by day:'); a.daily.forEach(x => out.push(`  - ${x.label}: ${fmt.plural(x.sessions, 'visit')}`)); }
            if (a.insights?.length) { out.push('', 'What this tells us:'); a.insights.forEach(x => out.push(`  - ${plain(x)}`)); }
        } else {
            out.push(a.headline, a.body);
            if (a.action) out.push(`What happens next: ${a.action}`);
        }
        out.push('');
    }

    const pg = m.page;
    if (pg) {
        out.push(rule('A CLOSER LOOK AT YOUR WEBSITE'));
        if (pg.google) {
            out.push('How your website looks on Google:', `  ${pg.google.title}`, `  ${pg.google.displayUrl}`, `  ${pg.google.description || '(no description - Google picks its own text)'}`);
            pg.google.notes.forEach(n => out.push(`  * ${n}`));
        }
        if (pg.glance) { out.push('', 'Your homepage at a glance:'); pg.glance.forEach(r => out.push(`  - ${r.label}: ${r.value}${r.note ? ` (${r.note})` : ''}`)); }
        if (pg.contact) { out.push('', 'Can visitors easily reach you?', `  ${pg.contact.summary}`); pg.contact.rows.forEach(r => out.push(`  [${r.ok ? 'yes' : 'no '}] ${r.label}`)); }
        if (pg.technical) { out.push('', 'Behind the scenes:'); pg.technical.forEach(r => out.push(`  - ${r.label}: ${r.value}`)); }
        if (pg.pages) { out.push('', 'Page by page:'); pg.pages.forEach(r => out.push(`  - ${r.name} (${r.path}): ${r.notes.length ? r.notes.join(', ') : 'looks complete'}${r.loadMs ? `, opened in ${fmt.seconds(r.loadMs)}` : ''}`)); }
        out.push('');
    }

    if (m.changes && (m.changes.fixed.length || m.changes.worse.length || m.changes.previousScore !== null)) {
        out.push(rule('WHAT CHANGED SINCE LAST TIME'));
        if (m.changes.previousScore !== null) out.push(`Score: ${m.health.score} (was ${m.changes.previousScore})`);
        if (m.changes.fixed.length) out.push(`Improved: ${fmt.list(m.changes.fixed)}`);
        if (m.changes.worse.length) out.push(`Newly flagged: ${fmt.list(m.changes.worse)}`);
        out.push('');
    }

    if ((m.ideas || []).length) {
        out.push(rule('OPTIONAL SUGGESTIONS'));
        m.ideas.forEach((r, i) => { out.push(`${i + 1}. ${r.title}`); if (r.why) out.push(`   ${plain(r.why)}`); if (r.how) out.push(`   ${plain(r.how)}`); });
        out.push('');
    }

    if (m.good.length) {
        out.push(rule('FOUND IN GOOD SHAPE'));
        m.good.forEach(i => out.push(`[OK] ${i.headline}${i.detail ? ` ${plain(i.detail)}` : ''}`));
        out.push('');
    }
    if (m.fyi.length) {
        out.push(rule('GOOD TO KNOW'));
        m.fyi.forEach(i => out.push(`[i] ${i.headline}${i.detail ? ` ${plain(i.detail)}` : ''}`));
        out.push('');
    }

    out.push(rule(`WHAT YOUR ${m.plan.name.toUpperCase()} PLAN COVERS`), m.plan.promise);
    (m.plan.handledByUs || []).forEach(h => out.push(`  - ${h}`));
    if (m.plan.stepUp) out.push('', `Want even more? Our ${m.plan.stepUp.to} plan adds: ${m.plan.stepUp.adds.join('; ')}. Reply if you would like to hear more.`);
    out.push('');

    if (m.glossary?.length) {
        out.push(rule('WORDS WE USED'));
        m.glossary.forEach(g => out.push(`${g.term}: ${g.meaning}`));
        out.push('');
    }
    out.push('Questions? Just reply to this email - a real person reads every reply.', `Phone / WhatsApp: ${COMPANY_PHONE}`, '', '- iCreate Solutions & Services');
    return out.join('\n');
}

// -----------------------------------------------------------------------------
// Monthly review
// -----------------------------------------------------------------------------
function renderMonthlyHtml(m) {
    const c = COLORS[TONE_COLOR[m.health.tone] || 'good'];
    const tiles = [];
    tiles.push({ label: 'Weekly reports', value: String(m.meta.reports), state: 'info' });
    if (m.availability) tiles.push({ label: 'Online', value: `${m.availability.ok}/${m.availability.checked}`, sub: 'weekly visits', state: m.availability.down ? 'warn' : 'good' });
    if (m.speed) tiles.push({ label: 'Avg. speed', value: `${(Math.round(m.speed.averageMs / 100) / 10)}s`, sub: 'homepage opens', state: m.speed.averageMs < 800 ? 'good' : m.speed.averageMs < 2000 ? 'warn' : 'bad' });
    if (m.traffic) tiles.push({ label: 'Visits', value: fmt.number(m.traffic.visits), sub: 'this month', state: 'info' });
    else if (m.health.averageScore !== null) tiles.push({ label: 'Avg. score', value: String(m.health.averageScore), sub: 'out of 100', state: 'info' });

    const tileHtml = tiles.slice(0, 4).map(t => {
        const tc = COLORS[STATE_COLOR[t.state] || 'info'];
        return `<td width="${Math.floor(100 / Math.min(tiles.length, 4))}%" align="center" valign="top" style="padding:0 4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="background:#ffffff;border:1px solid ${COLORS.line};border-top:4px solid ${tc.solid};border-radius:8px;padding:10px 4px;font-family:${FONT};">
            <div style="font-size:12px;letter-spacing:0.6px;text-transform:uppercase;color:${COLORS.muted};">${esc(t.label)}</div>
            <div style="font-size:21px;font-weight:bold;color:${tc.fg};padding-top:3px;">${esc(t.value)}</div>
            ${t.sub ? `<div style="font-size:12px;color:${COLORS.muted};padding-top:1px;">${esc(t.sub)}</div>` : ''}
        </td></tr></table></td>`;
    }).join('');

    const hero = card(`
        <div style="font-family:${FONT};font-size:18px;line-height:1.5;padding-bottom:4px;">Hello ${esc(m.meta.greeting)},</div>
        <div style="font-family:${FONT};font-size:16px;line-height:1.55;padding-bottom:14px;">Here is your monthly review for <strong>${esc(m.meta.monthName)}</strong>, pulling together everything we found in your ${esc(m.meta.reports)} weekly ${m.meta.reports === 1 ? 'report' : 'reports'}.</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px;"><tr><td style="background:${c.bg};border:1px solid ${c.bd};border-left:6px solid ${c.solid};border-radius:10px;padding:16px;font-family:${FONT};font-size:22px;line-height:1.35;font-weight:bold;color:${c.fg};">${esc(m.health.headline)}</td></tr></table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;"><tr>${tileHtml}</tr></table>`);

    const lines = [];
    if (m.availability) lines.push(`<div style="font-family:${FONT};font-size:16px;line-height:1.55;padding:4px 0;"><strong>Availability.</strong> ${esc(m.availability.text)}</div>`);
    if (m.speed) lines.push(`<div style="font-family:${FONT};font-size:16px;line-height:1.55;padding:4px 0;"><strong>Speed.</strong> Your homepage opened in <strong>${esc(fmt.seconds(m.speed.averageMs))}</strong> on average (quickest ${esc(fmt.seconds(m.speed.fastestMs))}, slowest ${esc(fmt.seconds(m.speed.slowestMs))}). Under a second feels instant to visitors.</div>`);
    if (m.scores?.length > 1) lines.push(`<div style="font-family:${FONT};font-size:16px;line-height:1.55;padding:4px 0;"><strong>Health score.</strong> ${esc(m.scores.map(s => s.score).join(' → '))} across the month (average ${esc(m.health.averageScore)}).</div>`);
    const healthCard = lines.length ? sectionTitle('How your website did') + card(lines.join('')) : '';

    let trafficCard = '';
    if (m.traffic) {
        const t = m.traffic;
        const max = Math.max(...t.weeklyBars.map(w => w.visits), 1);
        const trend = t.weeks > 1 ? (t.lastWeek > t.firstWeek ? `Visits grew from ${t.firstWeek} in the first week to ${t.lastWeek} in the latest.` : t.lastWeek < t.firstWeek ? `Visits eased from ${t.firstWeek} in the first week to ${t.lastWeek} in the latest.` : `Visits held steady at about ${t.lastWeek} a week.`) : '';
        trafficCard = sectionTitle('Your visitors this month') + card(`
            <div style="font-family:${FONT};font-size:19px;font-weight:bold;color:${COLORS.navy};line-height:1.4;">${esc(fmt.number(t.visits))} visits and ${esc(fmt.number(t.pageViews))} pages viewed</div>
            <div style="font-family:${FONT};font-size:16px;line-height:1.55;padding:4px 0 6px 0;">That is about ${esc(fmt.number(t.averagePeoplePerWeek))} different people each week. ${esc(trend)}${t.bestWeek ? ` Your busiest week was the one ending ${esc(fmt.dayMonth(t.bestWeek.date))}, with ${esc(fmt.plural(t.bestWeek.visits, 'visit'))}.` : ''}</div>
            ${t.weeks > 1 ? `<div style="font-family:${FONT};font-size:16px;font-weight:bold;color:${COLORS.navy};padding:10px 0 0 0;">Week by week</div>${barRows(t.weeklyBars.map(w => ({ label: `Week ending ${fmt.dayMonth(w.date)}`, percent: (w.visits / max) * 100, visits: w.visits })), { valueText: r => fmt.plural(r.visits, 'visit') })}` : ''}
            ${t.topPages.length ? `<div style="font-family:${FONT};font-size:16px;font-weight:bold;color:${COLORS.navy};padding:14px 0 0 0;">Most-viewed pages</div>${barRows(t.topPages.map(x => ({ label: x.path === '/' ? 'Home page' : (x.title ? x.title.split(/\s+[|\-–—·•:]\s+/)[0] : x.path), percent: (x.views / (t.topPages[0].views || 1)) * 100, views: x.views })), { valueText: r => fmt.plural(r.views, 'view') })}` : ''}
            ${t.channels.length ? `<div style="font-family:${FONT};font-size:16px;font-weight:bold;color:${COLORS.navy};padding:14px 0 0 0;">How people found you</div>${barRows(t.channels.map(x => ({ label: x.name, percent: x.share })), { colorKey: 'good', valueText: r => `${r.percent}%` })}` : ''}`);
    }

    let issuesCard = '';
    if (m.recurring.length || m.resolved.length) {
        const parts = [];
        if (m.recurring.length) parts.push(`<div style="font-family:${FONT};font-size:16px;font-weight:bold;color:${COLORS.warn.fg};padding-bottom:4px;">Still being watched</div>${m.recurring.map(r => `<div style="font-family:${FONT};font-size:16px;line-height:1.55;padding:2px 0;">! ${esc(r.name)} <span style="color:${COLORS.muted};">— flagged in ${esc(fmt.plural(r.weeks, 'weekly report'))}</span></div>`).join('')}`);
        if (m.resolved.length) parts.push(`<div style="font-family:${FONT};font-size:16px;font-weight:bold;color:${COLORS.good.fg};padding:${m.recurring.length ? 12 : 0}px 0 4px 0;">Sorted out this month</div>${m.resolved.map(r => `<div style="font-family:${FONT};font-size:16px;line-height:1.55;padding:2px 0;">✓ ${esc(r.name)}</div>`).join('')}`);
        issuesCard = sectionTitle('Things we kept an eye on') + card(parts.join(''));
    } else if (m.counts.reports) {
        issuesCard = sectionTitle('Things we kept an eye on') + card(`<div style="font-family:${FONT};font-size:16px;line-height:1.55;">Nothing needed fixing this month. Every weekly check came back clean.</div>`, { bg: COLORS.good.bg, border: COLORS.good.bd });
    }

    const body = [
        hero, healthCard, trafficCard, issuesCard,
        recommendationsSection({ recommendations: m.recommendations }),
        planSection({ plan: m.plan, analytics: m.traffic ? { state: 'ok' } : null }),
        helpSection({ meta: { planName: m.plan.name } })
    ].join('\n');
    return layout({ title: `Your ${m.meta.monthName} website review`, preheader: m.preheader, body, footerNote: `This review was put together automatically from your ${esc(m.meta.reports)} weekly website reports.` });
}

function renderMonthlyText(m) {
    const out = [`Hello ${m.meta.greeting},`, '', `Here is your monthly review for ${m.meta.monthName}.`, '', m.health.headline, ''];
    if (m.availability) out.push(`Availability: ${m.availability.text}`);
    if (m.speed) out.push(`Speed: your homepage opened in ${fmt.seconds(m.speed.averageMs)} on average (quickest ${fmt.seconds(m.speed.fastestMs)}, slowest ${fmt.seconds(m.speed.slowestMs)}).`);
    if (m.scores?.length > 1) out.push(`Health score across the month: ${m.scores.map(s => s.score).join(' -> ')} (average ${m.health.averageScore}).`);
    if (m.traffic) {
        out.push('', rule('YOUR VISITORS THIS MONTH'), `${fmt.number(m.traffic.visits)} visits and ${fmt.number(m.traffic.pageViews)} pages viewed (about ${fmt.number(m.traffic.averagePeoplePerWeek)} different people a week).`);
        m.traffic.topPages.forEach(x => out.push(`  - ${x.path === '/' ? 'Home page' : (x.title || x.path)}: ${fmt.plural(x.views, 'view')}`));
    }
    if (m.recurring.length) { out.push('', rule('STILL BEING WATCHED')); m.recurring.forEach(r => out.push(`  ! ${r.name} (flagged in ${fmt.plural(r.weeks, 'weekly report')})`)); }
    if (m.resolved.length) { out.push('', rule('SORTED OUT THIS MONTH')); m.resolved.forEach(r => out.push(`  OK ${r.name}`)); }
    if (!m.recurring.length && !m.resolved.length && m.counts.reports) out.push('', 'Nothing needed fixing this month. Every weekly check came back clean.');
    if (m.recommendations.length) { out.push('', rule('OUR SUGGESTIONS FOR YOU')); m.recommendations.forEach((r, i) => out.push(`${i + 1}. ${r.title}${r.how ? ` - ${plain(r.how)}` : ''}`)); }
    out.push('', 'Questions? Just reply to this email - a real person reads every reply.', `Phone / WhatsApp: ${COMPANY_PHONE}`, '', '- iCreate Solutions & Services');
    return out.join('\n');
}

// -----------------------------------------------------------------------------
// Admin alert (sent to the iCreate team, never to clients)
// -----------------------------------------------------------------------------
function renderAdminAlert({ clientName, planName, host, reasons = [], adminUrl }) {
    const rows = reasons.map(r => {
        const c = COLORS[r.level === 'critical' ? 'bad' : r.level === 'action' ? 'warn' : 'info'];
        return `<div style="padding:12px 0;border-top:1px solid ${COLORS.line};font-family:${FONT};">
            <div style="font-size:16px;font-weight:bold;color:${c.fg};">${esc(r.title)}</div>
            <div style="font-size:15px;line-height:1.55;padding-top:2px;">${inline(r.body || '')}</div>
            ${r.serviceAccountEmail ? `<div style="font-size:15px;padding-top:4px;">Reporting account to add as a Viewer: <strong>${esc(r.serviceAccountEmail)}</strong></div>` : ''}
            ${(r.steps || []).length ? `<ol style="margin:6px 0 0 20px;padding:0;font-size:15px;line-height:1.55;">${r.steps.map(s => `<li style="margin-bottom:3px;">${inline(s)}</li>`).join('')}</ol>` : ''}
        </div>`;
    }).join('');
    const hasCritical = reasons.some(r => r.level === 'critical');
    const subject = `${hasCritical ? 'ALERT' : 'Action needed'}: ${clientName}${host ? ` (${host})` : ''} — ${reasons[0]?.title || 'Client Care'}`.replace(/[\r\n]+/g, ' ');
    const body = card(`<div style="font-family:${FONT};font-size:20px;font-weight:bold;color:${COLORS.navy};">${esc(clientName)}</div>
        <div style="font-family:${FONT};font-size:15px;color:${COLORS.muted};padding:2px 0 8px 0;">${esc(planName || '')}${host ? ` · ${esc(host)}` : ''}</div>
        ${rows}
        ${adminUrl ? button('Open Client Care', adminUrl) : ''}`, { accent: hasCritical ? COLORS.bad.solid : COLORS.warn.solid });
    const text = [`${clientName}${host ? ` (${host})` : ''} — ${planName || ''}`, '',
        ...reasons.flatMap(r => [`* ${r.title}`, `  ${plain(r.body || '')}`, ...(r.serviceAccountEmail ? [`  Reporting account to add as a Viewer: ${r.serviceAccountEmail}`] : []), ...(r.steps || []).map((s, i) => `  ${i + 1}. ${plain(s)}`), '']),
        adminUrl ? `Open Client Care: ${adminUrl}` : ''].join('\n');
    return { subject, html: layout({ title: 'Client Care alert for the iCreate team', preheader: reasons[0]?.title || '', body, footerNote: 'Internal alert — not sent to clients.' }), text };
}

module.exports = { renderWeeklyHtml, renderWeeklyText, renderMonthlyHtml, renderMonthlyText, renderAdminAlert, esc, inline, plain };
