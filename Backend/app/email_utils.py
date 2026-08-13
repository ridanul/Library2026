import os
import smtplib
import ssl
from email.message import EmailMessage

SMTP_HOST = os.getenv("SMTP_HOST")
SMTP_PORT_RAW = os.getenv("SMTP_PORT", "0")
try:
    SMTP_PORT = int(SMTP_PORT_RAW or 0)
except ValueError:
    SMTP_PORT = 0
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASS = os.getenv("SMTP_PASS")
SMTP_FROM = os.getenv("SMTP_FROM", "no-reply@example.com")


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

    if not SMTP_HOST or not SMTP_PORT or not SMTP_USER or not SMTP_PASS:
        # Development mode - print to console
        print("\n" + "="*60)
        print("📧 EMAIL VERIFICATION CODE (Development Mode)")
        print("="*60)
        print(f"To: {to_email}")
        print(f"Subject: {subject}")
        print(f"Verification Code: {code}")
        print(f"Expires in: 15 minutes")
        print("="*60 + "\n")
        return

    context = ssl.create_default_context()

    try:
        if SMTP_PORT == 587:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
                server.starttls(context=context)
                server.login(SMTP_USER, SMTP_PASS)
                server.send_message(msg)
        else:
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=context, timeout=10) as server:
                server.login(SMTP_USER, SMTP_PASS)
                server.send_message(msg)
        print(f"✅ [email_utils] Email sent successfully to {to_email}")
    except Exception as e:
        print(f"❌ [email_utils] Failed to send email to {to_email}: {e}")
