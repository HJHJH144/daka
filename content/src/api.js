const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://daka-houduan.onrender.com';

async function request(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
        ...options,
    });

    let payload = {};
    try {
        payload = await response.json();
    } catch {
        payload = { ok: false, message: '服务返回了不可解析的数据' };
    }

    if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || `请求失败: ${response.status}`);
    }

    return payload;
}

export function login(studentId) {
    return request('/api/login', {
        method: 'POST',
        body: JSON.stringify({ studentId }),
    });
}

export function fetchSchedule({ userId, sessionId, dateStr }) {
    const query = new URLSearchParams({ userId, sessionId, dateStr });
    return request(`/api/schedule?${query.toString()}`);
}

export function signSingleDay({ userId, sessionId, dateStr, mode, selectedCourseIds }) {
    return request('/api/sign/single-day', {
        method: 'POST',
        body: JSON.stringify({ userId, sessionId, dateStr, mode, selectedCourseIds }),
    });
}

export function signRange({ userId, sessionId, startDate, endDate }) {
    return request('/api/sign/range', {
        method: 'POST',
        body: JSON.stringify({ userId, sessionId, startDate, endDate }),
    });
}

export function signContinuous({ userId, sessionId, startDate, maxDays = 120, emptyStopDays = 7 }) {
    return request('/api/sign/continuous', {
        method: 'POST',
        body: JSON.stringify({ userId, sessionId, startDate, maxDays, emptyStopDays }),
    });
}
