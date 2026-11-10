// Icons of catalogues, categories and items by their stored lucide name («laptop»): a small set the catalogue offers
// (a full icon map would load every icon); anything else shows the package icon.
import {
  AppWindow, Briefcase, Building2, Car, Cloud, CreditCard, Database, FileText, GraduationCap, HardDrive, Headset, KeyRound, Laptop, LayoutGrid, LifeBuoy,
  LockKeyholeOpen, Mail, MessageCircleQuestion, Monitor, Package, Phone, Printer, Server, ShieldCheck, Smartphone, Truck, UserPlus, Users, Wifi, Wrench,
  type LucideIcon,
} from "lucide-react";

export const CATALOG_ICONS: Record<string, LucideIcon> = {
  "app-window": AppWindow, briefcase: Briefcase, "building-2": Building2, car: Car, cloud: Cloud, "credit-card": CreditCard, database: Database,
  "file-text": FileText, "graduation-cap": GraduationCap, "hard-drive": HardDrive, headset: Headset, "key-round": KeyRound, laptop: Laptop,
  "layout-grid": LayoutGrid, "life-buoy": LifeBuoy, "lock-keyhole-open": LockKeyholeOpen, mail: Mail, "message-circle-question": MessageCircleQuestion,
  monitor: Monitor, package: Package, phone: Phone, printer: Printer, server: Server, "shield-check": ShieldCheck, smartphone: Smartphone,
  truck: Truck, "user-plus": UserPlus, users: Users, wifi: Wifi, wrench: Wrench,
};

export const iconOf = (name: string | null | undefined): LucideIcon => (name && CATALOG_ICONS[name]) || Package;
