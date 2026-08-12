import os
import smtplib
import ssl
from email.message import EmailMessage

SMTP_HOST = os.getenv("SMTP_HOST")
SMTP_PORT = int(os.getenv("SMTP_PORT", "0"))
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASS = os.getenv("SMTP_PASS")
SMTP_FROM = os.getenv("SMTP_FROM", "no-reply@example.com")


def send_verification_email(to_email: str, code: str):
    subject = "Your KiU Library verification code"
    body = f"Your verification code is: {code}\n\nThis code expires in 15 minutes.\n\nIf you didn't request this, please ignore."

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to_email
    msg.set_content(body)

    if not SMTP_HOST or not SMTP_PORT or not SMTP_USER or not SMTP_PASS:
        # Fallback: log to console
        print(f"[email_utils] SMTP not configured — would send to {to_email}: {code}")
        return

    context = ssl.create_default_context()
    try:
        if SMTP_PORT == 587:
            server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10)
            server.starttls(context=context)
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
            server.quit()
        else:
            # try SSL
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=context, timeout=10) as server:
                server.login(SMTP_USER, SMTP_PASS)
                server.send_message(msg)
    except Exception as e:
        print(f"[email_utils] Failed to send email: {e}")

    if not SMTP_HOST or not 