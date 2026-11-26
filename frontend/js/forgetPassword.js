(() => {
  const requestForm = document.getElementById("requestForm");
  const resetForm = document.getElementById("resetForm");
  const requestStep = document.getElementById("requestStep");
  const resetStep = document.getElementById("resetStep");
  const requestError = document.getElementById("requestError");
  const resetError = document.getElementById("resetError");
  const resetNotice = document.getElementById("resetNotice");
  const requestButton = document.getElementById("requestButton");
  const resetButton = document.getElementById("resetButton");
  const resendButton = document.getElementById("resendButton");
  let resetEmail = "";

  function showMessage(element, message) {
    element.textContent = message;
    element.classList.remove("hidden");
  }

  function hideMessage(element) {
    element.textContent = "";
    element.classList.add("hidden");
  }

  async function sendResetCode() {
    const errorElement = resetStep.classList.contains("hidden") ? requestError : resetError;
    requestButton.disabled = true;
    resendButton.disabled = true;
    hideMessage(requestError);
    hideMessage(resetError);
    hideMessage(resetNotice);
    try {
      await Api.requestPasswordReset({ email: resetEmail });
      requestStep.classList.add("hidden");
      resetStep.classList.remove("hidden");
      document.getElementById("resetInstructions").textContent =
        `If an account exists for ${resetEmail}, a reset code has been sent.`;
      showMessage(resetNotice, "Check your inbox, including the spam folder. The code expires in 15 minutes.");
      document.getElementById("resetCode").focus();
    } catch (error) {
      showMessage(errorElement, error.message || "Could not send a reset code. Please try again.");
    } finally {
      requestButton.disabled = false;
      resendButton.disabled = false;
    }
  }

  requestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    resetEmail = document.getElementById("resetEmail").value.trim();
    hideMessage(requestError);
    await sendResetCode();
  });

  resetForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideMessage(resetError);
    hideMessage(resetNotice);
    const newPassword = document.getElementById("newPassword").value;
    if (newPassword !== document.getElementById("confirmPassword").value) {
      showMessage(resetError, "The passwords do not match.");
      return;
    }
    const passwordProblem = Auth.passwordProblem(newPassword);
    if (passwordProblem) {
      showMessage(resetError, passwordProblem);
      return;
    }

    resetButton.disabled = true;
    try {
      const response = await Api.resetPassword({
        email: resetEmail,
        code: document.getElementById("resetCode").value.trim(),
        new_password: newPassword,
      });
      resetForm.reset();
      showMessage(resetNotice, response.message || "Password reset. You can now sign in.");
      resetButton.classList.add("hidden");
      resendButton.classList.add("hidden");
    } catch (error) {
      showMessage(resetError, error.message || "Could not reset your password. Check the code and try again.");
    } finally {
      resetButton.disabled = false;
    }
  });

  resendButton.addEventListener("click", async () => {
    hideMessage(resetNotice);
    await sendResetCode();
  });
})();
