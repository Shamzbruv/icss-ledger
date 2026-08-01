const DEFAULT_TIME_ZONE = 'America/Jamaica';
const WEEKDAY_INDEX = Object.freeze({
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
});

const formatterCache = new Map();

function isValidTimeZone(timeZone) {
    if (typeof timeZone !== 'string' || !timeZone.trim()) return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timeZone.trim() }).format();
        return true;
    } catch (_) {
        return false;
    }
}

function normalizeTimeZone(timeZone, fallback = DEFAULT_TIME_ZONE) {
    const requested = typeof timeZone === 'string' ? timeZone.trim() : '';
    if (isValidTimeZone(requested)) return requested;

    const safeFallback = typeof fallback === 'string' ? fallback.trim() : '';
    if (isValidTimeZone(safeFallback)) return safeFallback;
    return 'UTC';
}

function getFormatter(timeZone) {
    const normalized = normalizeTimeZone(timeZone);
    if (!formatterCache.has(normalized)) {
        formatterCache.set(normalized, new Intl.DateTimeFormat('en-US', {
            timeZone: normalized,
            calendar: 'gregory',
            numberingSystem: 'latn',
            hourCycle: 'h23',
            weekday: 'short',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }));
    }
    return formatterCache.get(normalized);
}

function asDate(value, label = 'date') {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(date.getTime())) throw new TypeError(`${label} must be a valid Date or date value`);
    return date;
}

function getZonedDateTimeParts(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
    const instant = asDate(date);
    const normalized = normalizeTimeZone(timeZone);
    const values = {};

    for (const part of getFormatter(normalized).formatToParts(instant)) {
        if (part.type !== 'literal') values[part.type] = part.value;
    }

    const weekday = WEEKDAY_INDEX[values.weekday];
    if (!Number.isInteger(weekday)) throw new Error(`Could not resolve weekday for ${normalized}`);

    return {
        year: Number(values.year),
        month: Number(values.month),
        day: Number(values.day),
        hour: Number(values.hour),
        minute: Number(values.minute),
        second: Number(values.second),
        weekday,
        timeZone: normalized
    };
}

function getLocalCalendarParts(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
    const parts = getZonedDateTimeParts(date, timeZone);
    return {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        weekday: parts.weekday,
        timeZone: parts.timeZone,
        dateKey: `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
    };
}

function getLocalDateKey(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
    return getLocalCalendarParts(date, timeZone).dateKey;
}

function isBirthdayOnDate(birthdayMonth, birthdayDay, date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
    const month = Number(birthdayMonth);
    const day = Number(birthdayDay);
    if (!Number.isInteger(month) || !Number.isInteger(day)) return false;
    const local = getLocalCalendarParts(date, timeZone);
    return local.month === month && local.day === day;
}

function parseLocalTime(value, fallback = '09:00') {
    const parse = candidate => {
        const match = String(candidate || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        if (!match) return null;
        const hour = Number(match[1]);
        const minute = Number(match[2]);
        const second = Number(match[3] || 0);
        if (hour > 23 || minute > 59 || second > 59) return null;
        return { hour, minute, second };
    };

    return parse(value) || parse(fallback) || { hour: 9, minute: 0, second: 0 };
}

function wallClockEpoch(parts) {
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
}

function sameWallClock(left, right) {
    return left.year === right.year
        && left.month === right.month
        && left.day === right.day
        && (left.hour || 0) === (right.hour || 0)
        && (left.minute || 0) === (right.minute || 0)
        && (left.second || 0) === (right.second || 0);
}

/**
 * Converts an IANA-zone wall-clock date/time to a UTC Date.
 *
 * For a repeated wall time during a DST fall-back, the first occurrence wins.
 * For a nonexistent wall time during a DST spring-forward, the next valid local
 * minute wins (for example, 02:30 becomes 03:00 when the clock skips to 03:00).
 */
function zonedDateTimeToUtc(localDateTime, timeZone = DEFAULT_TIME_ZONE) {
    const normalized = normalizeTimeZone(timeZone);
    const target = {
        year: Number(localDateTime?.year),
        month: Number(localDateTime?.month),
        day: Number(localDateTime?.day),
        hour: Number(localDateTime?.hour || 0),
        minute: Number(localDateTime?.minute || 0),
        second: Number(localDateTime?.second || 0)
    };

    if (!Number.isInteger(target.year)
        || !Number.isInteger(target.month) || target.month < 1 || target.month > 12
        || !Number.isInteger(target.day) || target.day < 1 || target.day > 31
        || !Number.isInteger(target.hour) || target.hour < 0 || target.hour > 23
        || !Number.isInteger(target.minute) || target.minute < 0 || target.minute > 59
        || !Number.isInteger(target.second) || target.second < 0 || target.second > 59) {
        throw new RangeError('Invalid local date/time parts');
    }

    const targetEpoch = wallClockEpoch(target);
    const calendarProbe = new Date(Date.UTC(target.year, target.month - 1, target.day));
    if (calendarProbe.getUTCFullYear() !== target.year
        || calendarProbe.getUTCMonth() !== target.month - 1
        || calendarProbe.getUTCDate() !== target.day) {
        throw new RangeError('Invalid local calendar date');
    }

    // Estimate the instant by observing the zone offset near the target date.
    let estimate = targetEpoch;
    for (let attempt = 0; attempt < 4; attempt++) {
        const observed = getZonedDateTimeParts(new Date(estimate), normalized);
        const correction = targetEpoch - wallClockEpoch(observed);
        estimate += correction;
        if (correction === 0) break;
    }

    // Search around the estimate to resolve DST overlaps and gaps deterministically.
    const scanRadiusMinutes = 4 * 60;
    const start = estimate - scanRadiusMinutes * 60_000;
    const end = estimate + scanRadiusMinutes * 60_000;
    let nextValid = null;
    let nextValidWallEpoch = Infinity;

    for (let instantMs = start; instantMs <= end; instantMs += 60_000) {
        const instant = new Date(instantMs);
        const observed = getZonedDateTimeParts(instant, normalized);
        if (sameWallClock(observed, target)) return instant;

        const observedEpoch = wallClockEpoch(observed);
        if (observedEpoch > targetEpoch
            && (observedEpoch < nextValidWallEpoch
                || (observedEpoch === nextValidWallEpoch && (!nextValid || instant < nextValid)))) {
            nextValid = instant;
            nextValidWallEpoch = observedEpoch;
        }
    }

    if (nextValid) return nextValid;
    throw new RangeError(`Could not resolve local time in ${normalized}`);
}

function clampInteger(value, minimum, maximum, fallback) {
    const numeric = Number(value);
    if (!Number.isInteger(numeric)) return fallback;
    return Math.min(maximum, Math.max(minimum, numeric));
}

function plainDateFromEpoch(epoch) {
    const date = new Date(epoch);
    return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate()
    };
}

function addLocalDays(parts, days) {
    return plainDateFromEpoch(Date.UTC(parts.year, parts.month - 1, parts.day + days));
}

function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthlyDate(year, month, requestedDay) {
    let normalizedYear = year;
    let normalizedMonth = month;
    while (normalizedMonth > 12) {
        normalizedMonth -= 12;
        normalizedYear += 1;
    }
    while (normalizedMonth < 1) {
        normalizedMonth += 12;
        normalizedYear -= 1;
    }
    return {
        year: normalizedYear,
        month: normalizedMonth,
        day: Math.min(requestedDay, daysInMonth(normalizedYear, normalizedMonth))
    };
}

function atLocalTime(dateParts, timeParts, timeZone) {
    return zonedDateTimeToUtc({ ...dateParts, ...timeParts }, timeZone);
}

/**
 * Returns the first scheduled instant strictly after `from`.
 * Supported frequencies are daily, weekly, and monthly.
 */
function calculateNextRun({
    frequency = 'weekly',
    sendDayOfWeek = 1,
    sendDayOfMonth = 1,
    sendTime = '09:00',
    timeZone,
    timezone,
    from = new Date()
} = {}) {
    const instant = asDate(from, 'from');
    const normalizedZone = normalizeTimeZone(timeZone || timezone);
    const localNow = getZonedDateTimeParts(instant, normalizedZone);
    const time = parseLocalTime(sendTime);
    const normalizedFrequency = String(frequency || '').trim().toLowerCase();

    if (normalizedFrequency === 'daily') {
        let dateParts = { year: localNow.year, month: localNow.month, day: localNow.day };
        let candidate = atLocalTime(dateParts, time, normalizedZone);
        if (candidate <= instant) {
            dateParts = addLocalDays(dateParts, 1);
            candidate = atLocalTime(dateParts, time, normalizedZone);
        }
        return candidate;
    }

    if (normalizedFrequency === 'weekly') {
        const weekday = clampInteger(sendDayOfWeek, 0, 6, 1);
        let dateParts = addLocalDays(localNow, (weekday - localNow.weekday + 7) % 7);
        let candidate = atLocalTime(dateParts, time, normalizedZone);
        if (candidate <= instant) {
            dateParts = addLocalDays(dateParts, 7);
            candidate = atLocalTime(dateParts, time, normalizedZone);
        }
        return candidate;
    }

    if (normalizedFrequency === 'monthly') {
        const monthDay = clampInteger(sendDayOfMonth, 1, 31, 1);
        let dateParts = monthlyDate(localNow.year, localNow.month, monthDay);
        let candidate = atLocalTime(dateParts, time, normalizedZone);
        if (candidate <= instant) {
            dateParts = monthlyDate(localNow.year, localNow.month + 1, monthDay);
            candidate = atLocalTime(dateParts, time, normalizedZone);
        }
        return candidate;
    }

    throw new RangeError(`Unsupported schedule frequency: ${frequency}`);
}

function calculateNextRunIso(options = {}) {
    return calculateNextRun(options).toISOString();
}

module.exports = {
    DEFAULT_TIME_ZONE,
    isValidTimeZone,
    normalizeTimeZone,
    parseLocalTime,
    getZonedDateTimeParts,
    getLocalCalendarParts,
    getLocalDateKey,
    isBirthdayOnDate,
    zonedDateTimeToUtc,
    calculateNextRun,
    calculateNextRunIso
};
