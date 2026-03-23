import { useMemo, useState } from 'react';
import { fetchSchedule, login, signContinuous, signRange, signSingleDay } from './api';
import './App.css';

function fmtTimeRange(begin, end) {
  const safeBegin = typeof begin === 'string' ? begin : '';
  const safeEnd = typeof end === 'string' ? end : '';
  return `${safeBegin.slice(0, 10)} ${safeBegin.slice(11, 16)}-${safeEnd.slice(11, 16)}`;
}

function normalizeDateInput(raw) {
  return raw.replaceAll('-', '').trim();
}

function App() {
  const [studentId, setStudentId] = useState('');
  const [auth, setAuth] = useState(null);
  const [mode, setMode] = useState('single');
  const [dateStr, setDateStr] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [continuousStartDate, setContinuousStartDate] = useState('');
  const [maxDays, setMaxDays] = useState(120);
  const [emptyStopDays, setEmptyStopDays] = useState(7);
  const [courses, setCourses] = useState([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState([]);
  const [selectAll, setSelectAll] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('请先登录');
  const [logs, setLogs] = useState([]);

  const canUseSystem = useMemo(() => Boolean(auth?.userId && auth?.sessionId), [auth]);

  function pushLog(text, level = 'info') {
    const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setLogs((prev) => [{ id: `${Date.now()}-${Math.random()}`, text, level, stamp }, ...prev]);
  }

  async function handleLogin(event) {
    event.preventDefault();
    const trimmed = studentId.trim();
    if (!trimmed) {
      setMessage('请输入学号');
      return;
    }

    setLoading(true);
    setMessage('登录中...');
    try {
      const res = await login(trimmed);
      setAuth({ userId: res.userId, sessionId: res.sessionId, studentId: trimmed });
      setMessage('登录成功');
      pushLog(`登录成功，userId=${res.userId}`, 'success');
    } catch (error) {
      setAuth(null);
      setMessage(error.message);
      pushLog(`登录失败: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleQuerySingleDay() {
    if (!canUseSystem) {
      setMessage('请先登录');
      return;
    }

    const normalized = normalizeDateInput(dateStr);
    if (!/^\d{8}$/.test(normalized)) {
      setMessage('单日日期格式应为 YYYYMMDD 或 YYYY-MM-DD');
      return;
    }

    setLoading(true);
    setMessage('查询课程中...');
    try {
      const res = await fetchSchedule({
        userId: auth.userId,
        sessionId: auth.sessionId,
        dateStr: normalized,
      });
      setCourses(res.courses || []);
      setSelectAll(true);
      setSelectedCourseIds((res.courses || []).map((course) => course.id));
      setMessage(`查询完成，共 ${res.courses?.length || 0} 门课程`);
      pushLog(`${normalized} 查询成功，课程数: ${res.courses?.length || 0}`, 'success');
    } catch (error) {
      setCourses([]);
      setSelectedCourseIds([]);
      setMessage(error.message);
      pushLog(`单日查询失败: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  function toggleCourse(courseId) {
    setSelectedCourseIds((prev) => {
      if (prev.includes(courseId)) {
        const next = prev.filter((item) => item !== courseId);
        setSelectAll(false);
        return next;
      }
      const next = [...prev, courseId];
      setSelectAll(next.length === courses.length && courses.length > 0);
      return next;
    });
  }

  function toggleSelectAll(value) {
    setSelectAll(value);
    setSelectedCourseIds(value ? courses.map((course) => course.id) : []);
  }

  async function handleSignSingleDay() {
    if (!canUseSystem) {
      setMessage('请先登录');
      return;
    }

    const normalized = normalizeDateInput(dateStr);
    if (!/^\d{8}$/.test(normalized)) {
      setMessage('单日日期格式应为 YYYYMMDD 或 YYYY-MM-DD');
      return;
    }

    if (!selectAll && selectedCourseIds.length === 0) {
      setMessage('请至少选择一门课程');
      return;
    }

    setLoading(true);
    setMessage('单日打卡执行中...');

    try {
      const res = await signSingleDay({
        userId: auth.userId,
        sessionId: auth.sessionId,
        dateStr: normalized,
        mode: selectAll ? 'all' : 'selected',
        selectedCourseIds,
      });

      setMessage(`单日打卡完成: ${res.successCount}/${res.total}`);
      pushLog(`单日打卡完成 ${res.dateStr}: ${res.successCount}/${res.total}`, 'success');
      for (const item of res.results || []) {
        const prefix = item.success ? '成功' : '失败';
        const level = item.success ? 'success' : 'error';
        pushLog(`${prefix}: ${item.courseName} (${fmtTimeRange(item.classBeginTime, item.classEndTime)})`, level);
      }
    } catch (error) {
      setMessage(error.message);
      pushLog(`单日打卡失败: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSignRange() {
    if (!canUseSystem) {
      setMessage('请先登录');
      return;
    }

    const start = normalizeDateInput(startDate);
    const end = normalizeDateInput(endDate);
    if (!/^\d{8}$/.test(start) || !/^\d{8}$/.test(end)) {
      setMessage('日期范围格式应为 YYYYMMDD 或 YYYY-MM-DD');
      return;
    }

    setLoading(true);
    setMessage('区间打卡执行中...');
    try {
      const res = await signRange({ userId: auth.userId, sessionId: auth.sessionId, startDate: start, endDate: end });
      setMessage(`区间打卡完成: ${res.successCount}/${res.totalCourses}`);
      pushLog(`区间打卡 ${res.startDate}-${res.endDate} 完成: ${res.successCount}/${res.totalCourses}`, 'success');

      for (const day of res.days || []) {
        if (!day.ok) {
          pushLog(`${day.dateStr} 查询失败: ${day.message}`, 'error');
          continue;
        }
        if ((day.courses || []).length === 0) {
          pushLog(`${day.dateStr} 无课程`, 'info');
          continue;
        }
        for (const course of day.courses) {
          const prefix = course.success ? '成功' : '失败';
          const level = course.success ? 'success' : 'error';
          pushLog(`${day.dateStr} ${prefix}: ${course.courseName}`, level);
        }
      }
    } catch (error) {
      setMessage(error.message);
      pushLog(`区间打卡失败: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSignContinuous() {
    if (!canUseSystem) {
      setMessage('请先登录');
      return;
    }

    const start = normalizeDateInput(continuousStartDate);
    if (!/^\d{8}$/.test(start)) {
      setMessage('连续打卡起始日期格式应为 YYYYMMDD 或 YYYY-MM-DD');
      return;
    }

    setLoading(true);
    setMessage('连续打卡执行中...');
    try {
      const res = await signContinuous({
        userId: auth.userId,
        sessionId: auth.sessionId,
        startDate: start,
        maxDays: Number(maxDays),
        emptyStopDays: Number(emptyStopDays),
      });

      setMessage(`连续打卡完成: ${res.successCount}/${res.totalCourses}`);
      pushLog(`连续打卡从 ${res.startDate} 完成: ${res.successCount}/${res.totalCourses}`, 'success');

      for (const day of res.days || []) {
        if (!day.ok) {
          pushLog(`${day.dateStr} 查询失败: ${day.message}`, 'error');
          continue;
        }
        if ((day.courses || []).length === 0) {
          pushLog(`${day.dateStr} ${day.message || '无课程'}`, 'info');
          continue;
        }
        for (const course of day.courses) {
          const prefix = course.success ? '成功' : '失败';
          const level = course.success ? 'success' : 'error';
          pushLog(`${day.dateStr} ${prefix}: ${course.courseName}`, level);
        }
      }
    } catch (error) {
      setMessage(error.message);
      pushLog(`连续打卡失败: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-shell">
      <header className="hero">
        <div>
          <p className="badge">BUAA iClass</p>
          <h1>课程打卡前端控制台</h1>
          <p className="subtitle">连接本地 Python 服务，执行与 CLI 脚本同等的登录、查课与打卡流程。</p>
        </div>
        <div className="status-box">
          <p>状态</p>
          <strong>{loading ? '处理中' : canUseSystem ? '已登录' : '未登录'}</strong>
          <span>{message}</span>
        </div>
      </header>

      <main className="layout">
        <section className="panel">
          <h2>1. 登录</h2>
          <form className="row" onSubmit={handleLogin}>
            <input
              value={studentId}
              onChange={(event) => setStudentId(event.target.value)}
              placeholder="请输入学号"
              disabled={loading}
            />
            <button type="submit" disabled={loading}>登录</button>
          </form>
          {auth && (
            <p className="hint">
              当前账号: {auth.studentId} | userId: {auth.userId}
            </p>
          )}
        </section>

        <section className="panel">
          <h2>2. 模式选择</h2>
          <div className="mode-tabs">
            <button className={mode === 'single' ? 'active' : ''} onClick={() => setMode('single')} disabled={loading}>
              单日
            </button>
            <button className={mode === 'range' ? 'active' : ''} onClick={() => setMode('range')} disabled={loading}>
              日期范围
            </button>
            <button className={mode === 'continuous' ? 'active' : ''} onClick={() => setMode('continuous')} disabled={loading}>
              连续打卡
            </button>
          </div>

          {mode === 'single' && (
            <div className="mode-body">
              <div className="row">
                <input
                  value={dateStr}
                  onChange={(event) => setDateStr(event.target.value)}
                  placeholder="YYYYMMDD 或 YYYY-MM-DD"
                  disabled={loading}
                />
                <button onClick={handleQuerySingleDay} disabled={loading || !canUseSystem}>查询课程</button>
                <button onClick={handleSignSingleDay} disabled={loading || !canUseSystem}>执行打卡</button>
              </div>

              <div className="row check-row">
                <label>
                  <input
                    type="checkbox"
                    checked={selectAll}
                    onChange={(event) => toggleSelectAll(event.target.checked)}
                    disabled={loading || courses.length === 0}
                  />
                  打卡全部课程
                </label>
              </div>

              <div className="course-list">
                {courses.length === 0 ? (
                  <p className="hint">暂无课程数据，请先查询。</p>
                ) : (
                  courses.map((course) => (
                    <label key={course.id} className="course-item">
                      <input
                        type="checkbox"
                        checked={selectAll || selectedCourseIds.includes(course.id)}
                        onChange={() => toggleCourse(course.id)}
                        disabled={loading || selectAll}
                      />
                      <span className="course-title">{course.courseName}</span>
                      <span className="course-time">{fmtTimeRange(course.classBeginTime, course.classEndTime)}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}

          {mode === 'range' && (
            <div className="mode-body">
              <div className="row">
                <input
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  placeholder="开始日期 YYYYMMDD"
                  disabled={loading}
                />
                <input
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  placeholder="结束日期 YYYYMMDD"
                  disabled={loading}
                />
                <button onClick={handleSignRange} disabled={loading || !canUseSystem}>执行区间打卡</button>
              </div>
            </div>
          )}

          {mode === 'continuous' && (
            <div className="mode-body">
              <div className="row">
                <input
                  value={continuousStartDate}
                  onChange={(event) => setContinuousStartDate(event.target.value)}
                  placeholder="起始日期 YYYYMMDD"
                  disabled={loading}
                />
                <input
                  type="number"
                  value={maxDays}
                  onChange={(event) => setMaxDays(event.target.value)}
                  placeholder="最大天数"
                  min="1"
                  disabled={loading}
                />
                <input
                  type="number"
                  value={emptyStopDays}
                  onChange={(event) => setEmptyStopDays(event.target.value)}
                  placeholder="连续无课停止天数"
                  min="1"
                  disabled={loading}
                />
                <button onClick={handleSignContinuous} disabled={loading || !canUseSystem}>执行连续打卡</button>
              </div>
            </div>
          )}
        </section>

        <section className="panel logs-panel">
          <h2>执行日志</h2>
          <div className="logs">
            {logs.length === 0 ? (
              <p className="hint">暂无日志。</p>
            ) : (
              logs.map((log) => (
                <div key={log.id} className={`log-item ${log.level}`}>
                  <span>{log.stamp}</span>
                  <p>{log.text}</p>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
