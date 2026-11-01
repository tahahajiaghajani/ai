// Ordered list of schema migrations. Never edit a migration that has shipped: add a new file.
// `npm run schema` writes them to supabase/schema.sql and supabase/migrations/*.sql.
import core from "./0001_core";
import accounting from "./0002_accounting";
import partiesTreasury from "./0003_parties_treasury";
import inventoryCommerce from "./0004_inventory_commerce";
import gold from "./0005_gold";
import fx from "./0006_fx";
import integrationsSync from "./0007_integrations_sync";
import treasury from "./0008_treasury";
import goods from "./0009_goods";
import gold2 from "./0010_gold";
import fx2 from "./0011_fx";

export interface Migration {
  id: string;
  title: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  { id: "0001_core", title: "هسته: کاربران، سازمان‌ها، همگام‌سازی", sql: core },
  { id: "0002_accounting", title: "حسابداری: سال مالی، کدینگ، اسناد", sql: accounting },
  { id: "0003_parties_treasury", title: "اشخاص و خزانه‌داری", sql: partiesTreasury },
  { id: "0004_inventory_commerce", title: "کالا، انبار، خرید و فروش", sql: inventoryCommerce },
  { id: "0005_gold", title: "طلا و جواهر", sql: gold },
  { id: "0006_fx", title: "صرافی و ارز دیجیتال", sql: fx },
  { id: "0007_integrations_sync", title: "اتصال‌ها، تریگرهای همگام‌سازی و امنیت", sql: integrationsSync },
  { id: "0008_treasury", title: "خزانه‌داری و چک", sql: treasury },
  { id: "0009_goods", title: "کالا، انبار و فاکتور", sql: goods },
  { id: "0010_gold", title: "طلا و جواهر (تکمیلی)", sql: gold2 },
  { id: "0011_fx", title: "صرافی و رمزارز (تکمیلی)", sql: fx2 },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].id;
