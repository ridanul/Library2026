import os
import smtplib
import ssl
from email.message import EmailMessage

import httpx

SMTP_HOST = os.getenv("SMTP_HOST")
SMTP_PORT_RAW = os.getenv("SMTP_PORT", "0")
try:
    SMTP_PORT = int(SMTP_PORT_RAW or 0)
except ValueError:
    SMTP_PORT = 0
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASS = os.getenv("SMTP_PASS")
SMTP_FROM = os.getenv("SMTP_FROM", "no-reply@example.com")

BREVO_API_KEY = os.getenv("BREVO_API_KEY")
BREVO_SENDER_EMAIL = os.getenv("BREVO_SENDER_EMAIL")
BREVO_SENDER_NAME = os.getenv("BREVO_SENDER_NAME", "KiU Library")


def _print_dev_email(to_email: str, subject: str, code: str):
    print("\n" + "=" * 60)
    print("📧 EMAIL VERIFICATION CODE (Development Mode)")
    print("=" * 60)
    print(f"To: {to_email}")
    print(f"Subject: {subject}")
    print(f"Verification Code: {code}")
    print("Expires in: 15 minutes")
    print("=" * 60 + "\n")


def _send_via_brevo(to_email: str, subject: str, body: str):
    payload = {
        "sender": {
            "name": BREVO_SENDER_NAME,
            "email": BREVO_SENDER_EMAIL,
        },
        "to": [{"email": to_email}],
        "subject": subject,
        "textContent": body,
    }
    headers = {
        "accept": "application/json",
        "api-key": BREVO_API_KEY,
        "content-type": "application/json",
    }
    res = httpx.post("https://api.brevo.com/v3/smtp/email", headers=headers, json=payload, timeout=10.0)
    res.raise_for_status()
    print(f"✅ [email_utils] Email sent successfully to {to_email} via Brevo API")


def _send_via_smtp(msg: EmailMessage, to_email: str):
    context = ssl.create_default_context()
    if SMTP_PORT == 587:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
            server.starttls(context=context)
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
    else:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=context, timeout=10) as server:
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
    print(f"✅ [email_utils] Email sent successfully to {to_email} via SMTP")


def send_verification_email(to_email: str, code: str):
    subject = "Your KiU Library verification code"
    body = (
        f"Your verification code is: {code}\n\n"
        "This code expires in 15 minutes.\n\n"
        "If you didn't request this, please ignore."
    )

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to_email
    msg.set_content(body)

    can_use_brevo = bool(BREVO_API_KEY and BREVO_SENDER_EMAIL)
    can_use_smtp = bool(SMTP_HOST and SMTP_PORT and SMTP_USER and SMTP_PASS)

    try:
        if can_use_brevo:
            _send_via_brevo(to_email, subject, body)
            return
        if can_use_smtp:
            _send_via_smtp(msg, to_email)
            return
        _print_dev_email(to_email, subject, code)
    except Exception as e:
        if can_use_brevo and can_use_smtp:
            try:
                _send_via_smtp(msg, to_email)
                return
            except Exception as smtp_err:
                print(f"❌ [email_utils] Brevo and SMTP send failed for {to_email}: brevo={e}; smtp={smtp_err}")
        else:
            print(f"❌ [email_utils] Failed to send email to {to_email}: {e}")
