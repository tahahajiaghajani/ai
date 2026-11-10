; Custom pages and texts of the Persian installer. ${PRODUCT_NAME} is electron-builder's productName
; (electron-builder.yml), so this file never names the product itself.

; always install for the current user (no administrator prompt, no extra English page)
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "به نصب «${PRODUCT_NAME}» خوش آمدید"
  !define MUI_WELCOMEPAGE_TEXT "«${PRODUCT_NAME}»، سامانهٔ سازمانی مدیریت خدمات فناوری اطلاعات، روی این رایانه نصب می‌شود.$\r$\n$\r$\nبرنامه بدون اینترنت هم کار می‌کند و هر وقت خواستید با نسخهٔ وب هم‌گام می‌شود.$\r$\n$\r$\nبرای ادامه روی «بعدی» کلیک کنید."
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
  !define MUI_FINISHPAGE_TITLE "نصب «${PRODUCT_NAME}» تمام شد"
  !define MUI_FINISHPAGE_TEXT "برنامه آمادهٔ استفاده است. میان‌بر آن روی میز کار و در منوی شروع ساخته شد.$\r$\n$\r$\nداده‌ها در پوشهٔ کاربر ویندوز نگه داشته می‌شوند و با حذف برنامه پاک نمی‌شوند."
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "اجرای ${PRODUCT_NAME}"
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !insertmacro MUI_PAGE_FINISH
!macroend
