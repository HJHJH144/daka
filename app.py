from __future__ import annotations

import datetime
import json
import os
import time
from typing import Any, Dict, List, Tuple

import requests
from flask import Flask, jsonify, request
from flask_cors import CORS

LOGIN_URL = "https://iclass.buaa.edu.cn:8346/app/user/login.action"
SCHEDULE_URL = "https://iclass.buaa.edu.cn:8346/app/course/get_stu_course_sched.action"
SIGN_URL = "http://iclass.buaa.edu.cn:8081/app/course/stu_scan_sign.action"

app = Flask(__name__)
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "https://hjhjh144.github.io")
CORS(app, resources={r"/api/*": {"origins": [FRONTEND_ORIGIN]}})


def _safe_json_loads(text: str) -> Dict[str, Any]:
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
        return {"STATUS": "-1", "ERRORMSG": "响应格式异常"}
    except json.JSONDecodeError:
        return {"STATUS": "-1", "ERRORMSG": "响应不是有效的JSON"}


def _validate_date_str(date_str: str) -> bool:
    try:
        datetime.datetime.strptime(date_str, "%Y%m%d")
        return True
    except ValueError:
        return False


def login_student(student_id: str) -> Tuple[bool, Dict[str, Any]]:
    params = {
        "phone": student_id,
        "userLevel": "1",
        "verificationType": "2",
        "verificationUrl": "",
    }

    try:
        resp = requests.get(url=LOGIN_URL, params=params, timeout=10)
    except requests.RequestException as exc:
        return False, {"message": f"网络请求失败: {exc}"}

    data = _safe_json_loads(resp.text)
    if data.get("STATUS") != "0":
        return False, {"message": data.get("ERRORMSG", "登录失败")}

    result = data.get("result") or {}
    user_id = result.get("id")
    session_id = result.get("sessionId")
    if not user_id or not session_id:
        return False, {"message": "登录响应缺少 userId 或 sessionId"}

    return True, {
        "userId": str(user_id),
        "sessionId": str(session_id),
    }


def get_course_schedule(user_id: str, session_id: str, date_str: str) -> Tuple[bool, Dict[str, Any]]:
    params = {
        "dateStr": date_str,
        "id": user_id,
    }
    headers = {"sessionId": session_id}

    try:
        resp = requests.get(url=SCHEDULE_URL, params=params, headers=headers, timeout=10)
    except requests.RequestException as exc:
        return False, {"message": f"获取课程表失败: {exc}"}

    data = _safe_json_loads(resp.text)
    if data.get("STATUS") != "0":
        return False, {"message": data.get("ERRORMSG", "查询课程失败")}

    courses = data.get("result")
    if not isinstance(courses, list):
        return False, {"message": "课程数据格式异常"}

    normalized = []
    for item in courses:
        if not isinstance(item, dict):
            continue
        normalized.append(
            {
                "id": str(item.get("id", "")),
                "courseName": str(item.get("courseName", "")),
                "classBeginTime": str(item.get("classBeginTime", "")),
                "classEndTime": str(item.get("classEndTime", "")),
            }
        )

    return True, {"courses": normalized}


def sign_course(user_id: str, course_sched_id: str) -> Tuple[bool, Dict[str, Any]]:
    params = {"id": user_id}
    timestamp = int(time.time() * 1000)
    url = f"{SIGN_URL}?courseSchedId={course_sched_id}&timestamp={timestamp}"

    try:
        resp = requests.post(url=url, params=params, timeout=10)
    except requests.RequestException as exc:
        return False, {"message": f"打卡请求失败: {exc}"}

    if not resp.ok:
        return False, {"message": f"打卡失败，状态码: {resp.status_code}"}
    return True, {"message": "打卡成功"}


def _date_range(start_date: str, end_date: str) -> List[str]:
    start = datetime.datetime.strptime(start_date, "%Y%m%d")
    end = datetime.datetime.strptime(end_date, "%Y%m%d")
    days: List[str] = []
    current = start
    while current <= end:
        days.append(current.strftime("%Y%m%d"))
        current += datetime.timedelta(days=1)
    return days


def _course_result(course: Dict[str, str], success: bool, message: str) -> Dict[str, Any]:
    return {
        "courseSchedId": course.get("id", ""),
        "courseName": course.get("courseName", ""),
        "classBeginTime": course.get("classBeginTime", ""),
        "classEndTime": course.get("classEndTime", ""),
        "success": success,
        "message": message,
    }


@app.get("/api/health")
def health() -> Any:
    return jsonify({"ok": True})


@app.post("/api/login")
def api_login() -> Any:
    payload = request.get_json(silent=True) or {}
    student_id = str(payload.get("studentId", "")).strip()

    if not student_id:
        return jsonify({"ok": False, "message": "studentId 不能为空"}), 400

    ok, data = login_student(student_id)
    status = 200 if ok else 400
    return jsonify({"ok": ok, **data}), status


@app.get("/api/schedule")
def api_schedule() -> Any:
    user_id = str(request.args.get("userId", "")).strip()
    session_id = str(request.args.get("sessionId", "")).strip()
    date_str = str(request.args.get("dateStr", "")).strip()

    if not user_id or not session_id or not date_str:
        return jsonify({"ok": False, "message": "缺少 userId/sessionId/dateStr"}), 400
    if not _validate_date_str(date_str):
        return jsonify({"ok": False, "message": "dateStr 格式必须为 YYYYMMDD"}), 400

    ok, data = get_course_schedule(user_id, session_id, date_str)
    status = 200 if ok else 400
    return jsonify({"ok": ok, "dateStr": date_str, **data}), status


@app.post("/api/sign")
def api_sign() -> Any:
    payload = request.get_json(silent=True) or {}
    user_id = str(payload.get("userId", "")).strip()
    course_sched_id = str(payload.get("courseSchedId", "")).strip()

    if not user_id or not course_sched_id:
        return jsonify({"ok": False, "message": "缺少 userId 或 courseSchedId"}), 400

    ok, data = sign_course(user_id, course_sched_id)
    status = 200 if ok else 400
    return jsonify({"ok": ok, **data}), status


@app.post("/api/sign/single-day")
def api_sign_single_day() -> Any:
    payload = request.get_json(silent=True) or {}
    user_id = str(payload.get("userId", "")).strip()
    session_id = str(payload.get("sessionId", "")).strip()
    date_str = str(payload.get("dateStr", "")).strip()
    mode = str(payload.get("mode", "all")).strip().lower()
    selected_ids = payload.get("selectedCourseIds") or []

    if not user_id or not session_id or not date_str:
        return jsonify({"ok": False, "message": "缺少 userId/sessionId/dateStr"}), 400
    if not _validate_date_str(date_str):
        return jsonify({"ok": False, "message": "dateStr 格式必须为 YYYYMMDD"}), 400
    if mode not in {"all", "selected"}:
        return jsonify({"ok": False, "message": "mode 仅支持 all 或 selected"}), 400

    ok, schedule_data = get_course_schedule(user_id, session_id, date_str)
    if not ok:
        return jsonify({"ok": False, "message": schedule_data.get("message", "查询课程失败")}), 400

    courses: List[Dict[str, str]] = schedule_data.get("courses", [])
    if mode == "selected":
        selected_set = {str(item) for item in selected_ids}
        courses = [course for course in courses if course.get("id") in selected_set]

    results = []
    success_count = 0
    for course in courses:
        sign_ok, sign_data = sign_course(user_id, course.get("id", ""))
        if sign_ok:
            success_count += 1
        results.append(_course_result(course, sign_ok, sign_data.get("message", "")))
        time.sleep(0.3)

    return jsonify(
        {
            "ok": True,
            "dateStr": date_str,
            "total": len(courses),
            "successCount": success_count,
            "results": results,
        }
    )


@app.post("/api/sign/range")
def api_sign_range() -> Any:
    payload = request.get_json(silent=True) or {}
    user_id = str(payload.get("userId", "")).strip()
    session_id = str(payload.get("sessionId", "")).strip()
    start_date = str(payload.get("startDate", "")).strip()
    end_date = str(payload.get("endDate", "")).strip()

    if not user_id or not session_id or not start_date or not end_date:
        return jsonify({"ok": False, "message": "缺少 userId/sessionId/startDate/endDate"}), 400
    if not _validate_date_str(start_date) or not _validate_date_str(end_date):
        return jsonify({"ok": False, "message": "日期格式必须为 YYYYMMDD"}), 400
    if start_date > end_date:
        return jsonify({"ok": False, "message": "startDate 不能大于 endDate"}), 400

    day_results: List[Dict[str, Any]] = []
    total_courses = 0
    total_success = 0

    for day in _date_range(start_date, end_date):
        ok, schedule_data = get_course_schedule(user_id, session_id, day)
        if not ok:
            day_results.append(
                {
                    "dateStr": day,
                    "ok": False,
                    "message": schedule_data.get("message", "查询课程失败"),
                    "courses": [],
                }
            )
            continue

        courses: List[Dict[str, str]] = schedule_data.get("courses", [])
        course_results: List[Dict[str, Any]] = []
        for course in courses:
            sign_ok, sign_data = sign_course(user_id, course.get("id", ""))
            if sign_ok:
                total_success += 1
            total_courses += 1
            course_results.append(_course_result(course, sign_ok, sign_data.get("message", "")))
            time.sleep(0.3)

        day_results.append({"dateStr": day, "ok": True, "message": "", "courses": course_results})

    return jsonify(
        {
            "ok": True,
            "startDate": start_date,
            "endDate": end_date,
            "totalCourses": total_courses,
            "successCount": total_success,
            "days": day_results,
        }
    )


@app.post("/api/sign/continuous")
def api_sign_continuous() -> Any:
    payload = request.get_json(silent=True) or {}
    user_id = str(payload.get("userId", "")).strip()
    session_id = str(payload.get("sessionId", "")).strip()
    start_date = str(payload.get("startDate", "")).strip()
    max_days = int(payload.get("maxDays", 120))
    empty_stop_days = int(payload.get("emptyStopDays", 7))

    if not user_id or not session_id or not start_date:
        return jsonify({"ok": False, "message": "缺少 userId/sessionId/startDate"}), 400
    if not _validate_date_str(start_date):
        return jsonify({"ok": False, "message": "startDate 格式必须为 YYYYMMDD"}), 400
    if max_days <= 0 or empty_stop_days <= 0:
        return jsonify({"ok": False, "message": "maxDays 和 emptyStopDays 必须大于 0"}), 400

    current = datetime.datetime.strptime(start_date, "%Y%m%d")
    empty_count = 0
    day_results: List[Dict[str, Any]] = []
    total_courses = 0
    total_success = 0

    for _ in range(max_days):
        day = current.strftime("%Y%m%d")
        ok, schedule_data = get_course_schedule(user_id, session_id, day)

        if not ok:
            day_results.append(
                {
                    "dateStr": day,
                    "ok": False,
                    "message": schedule_data.get("message", "查询课程失败"),
                    "courses": [],
                }
            )
            empty_count += 1
            if empty_count >= empty_stop_days:
                break
            current += datetime.timedelta(days=1)
            continue

        courses: List[Dict[str, str]] = schedule_data.get("courses", [])
        if not courses:
            day_results.append({"dateStr": day, "ok": True, "message": "无课程", "courses": []})
            empty_count += 1
            if empty_count >= empty_stop_days:
                break
            current += datetime.timedelta(days=1)
            continue

        empty_count = 0
        course_results: List[Dict[str, Any]] = []
        for course in courses:
            sign_ok, sign_data = sign_course(user_id, course.get("id", ""))
            if sign_ok:
                total_success += 1
            total_courses += 1
            course_results.append(_course_result(course, sign_ok, sign_data.get("message", "")))
            time.sleep(0.3)

        day_results.append({"dateStr": day, "ok": True, "message": "", "courses": course_results})
        current += datetime.timedelta(days=1)

    return jsonify(
        {
            "ok": True,
            "startDate": start_date,
            "maxDays": max_days,
            "emptyStopDays": empty_stop_days,
            "totalCourses": total_courses,
            "successCount": total_success,
            "days": day_results,
        }
    )


if __name__ == "__main__":
    host = os.getenv("FLASK_HOST", "0.0.0.0")
    port = int(os.getenv("FLASK_PORT", "5000"))
    debug = os.getenv("FLASK_DEBUG", "true").lower() == "true"
    app.run(host=host, port=port, debug=debug)
