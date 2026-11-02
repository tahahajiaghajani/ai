; Custom pages and texts for the Persian installer of «تراز».

; always install for the current user (no administrator prompt, no extra English page)
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "به نصب «تراز» خوش آمدید"
  !define MUI_WELCOMEPAGE_TEXT "تراز، حسابداری و مدیریت کسب‌وکار (کالا، طلا و صرافی) را روی این رایانه نصب می‌کند.$\r$\n$\r$\nبرنامه بدون اینترنت کار می‌کند و هر وقت خواستید با نسخه‌ی وب هم‌گام می‌شود.$\r$\n$\r$\nبرای ادامه روی «بعدی» کلیک کنید."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd
  !define MUI_FINISHPAGE_TITLE "نصب «تراز» تمام شد"
  !define MUI_FINISHPAGE_TEXT "برنامه آماده‌ی استفاده است. میان‌بر «تراز» روی میز کار و در منوی شروع ساخته شد.$\r$\n$\r$\nداده‌ها در پوشه‌ی کاربر ویندوز نگه داشته می‌شوند و با حذف برنامه پاک نمی‌شوند."
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "اجرای تراز"
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !insertmacro MUI_PAGE_FINISH
!macroend
