import { Alert, Button, Typography } from "antd";
import { CopyOutlined } from "@ant-design/icons";

export function RecoveryCode({ code, onDone }: { code: string; onDone: () => void }) {
  return (
    <div>
      <Alert
        type="warning"
        showIcon
        title="کد بازیابی خود را نگه دارید"
        description="اگر رمز عبور را فراموش کنید، فقط با این کد می‌توانید رمز تازه بگذارید. آن را یادداشت یا چاپ کنید و جای امنی نگه دارید؛ دوباره نمایش داده نمی‌شود."
      />
      <div className="my-5 rounded-xl border-2 border-dashed border-gold bg-gold-soft p-5 text-center">
        <Typography.Text copyable={{ text: code, icon: [<CopyOutlined key="c" />, <CopyOutlined key="d" />], tooltips: ["کپی", "کپی شد"] }} className="ltr font-mono text-xl font-bold tracking-widest">
          {code}
        </Typography.Text>
      </div>
      <Button type="primary" size="large" block onClick={onDone}>
        یادداشت کردم، ادامه
      </Button>
    </div>
  );
}
