// «مکان‌ها»: region → country → province → city → site → building → floor → room, with addresses and time zones.
import { Form, Input } from "antd";
import { LOCATION_KINDS } from "@shared/tables/access";
import { TreeEditor } from "./TreeEditor";
import { LOCATION_ICON } from "./parts";

export default function Locations() {
  return (
    <TreeEditor
      table="location"
      title="مکان‌ها"
      noun="مکان"
      kinds={LOCATION_KINDS}
      icons={LOCATION_ICON}
      defaultKind="site"
      extra={
        <>
          <Form.Item name="timezone" label="منطقهٔ زمانی">
            <Input dir="ltr" placeholder="Asia/Tehran" maxLength={60} />
          </Form.Item>
          <Form.Item name="address" label="نشانی">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} />
          </Form.Item>
        </>
      }
    />
  );
}
