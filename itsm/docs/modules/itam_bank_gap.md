# ITAM for an Iranian bank — gap analysis

Scope: what the bank's IT asset, logistics («اموال») and audit teams expect, compared with ITAM as delivered in Kariz
1.0 (`src/shared/tables/itam.ts`, `src/server/modules/itam`, `src/ui/modules/itam`, guide `itam_FA.md`). Status
before this round: **exists** / **partial** / **missing**. The last column says what release 1.1 does about it
(«built» = in this round, with tests; «later» = open).

## 1. Bank device classes and attributes

| Need | Before | 1.1 |
| --- | --- | --- |
| ATM, CRS / cash recycler, kiosk as device classes | missing (generic categories: laptop, server, network…) | built: categories `atm`, `crs`, `kiosk` and the fleet view |
| POS merchant terminals (Shaparak PSP rules: terminal id, merchant id, PSP) | missing | built: category `pos`, fields terminal id, merchant id, PSP (the PSP list is an editable choice) |
| Passbook printer, cheque scanner, signature pad, HSM, CCTV/NVR, UPS | missing | built: categories with per-class attributes (`BANK_DEVICE_CLASSES`) |
| Branch network gear, core servers and storage | exists (network, server, storage) | kept; bank models seeded |
| Class-specific attributes (cassettes, OS, FIPS level, kVA, channels…) | missing | built: per-class attribute list, values in `asset.attributes`, edited on the asset |
| Bank models seeded (NCR, Diebold Nixdorf, GRG, Hyosung, PAX, Verifone, Thales, Olivetti, Panini, Wacom, Hikvision, APC…) | missing | built: seeded with depreciation classes and data-bearing flags |

## 2. Branch-level inventory

| Need | Before | 1.1 |
| --- | --- | --- |
| Every asset belongs to a branch / region / province unit of the org tree | partial (`department_id`, `location_id`; access anchor is the holder's unit) | built: `asset.branch_id` (org unit, kind branch or above) is the asset's access anchor |
| Branch staff see their branch's assets, regional managers their region (unit_tree) | missing (agents read every asset) | built: seeded roles «مسئول اموال شعبه» (unit) and «مدیر اموال منطقه» (unit tree), «رئیس شعبه» (reads, attests) |
| Branch view (counts, value, discrepancies, transfers in/out) | missing | built: «اموال شعبه‌ها» |
| Transfer between branches: dispatch note and receipt («حواله و رسید انتقال») with approval | partial (state «در راه», stock movements transfer_out/in, no document) | built: `asset_transfer` + items, approval, dispatch, receipt by the receiving branch, discrepancies |
| Chain of custody for internal auditors and regulators | partial (assignment and stock ledgers) | built: `asset_custody`, an insert-only, hash-chained ledger per asset |
| Per-branch physical audit with barcode/QR from a phone browser | partial (desk audit with a keyboard-wedge scanner, stockroom/location scope) | built: branch scope, mobile scan page with the camera (BarcodeDetector, no CDN) and manual entry |
| Discrepancy report and reconciliation | partial (found / moved / missing / unexpected counts) | built: per-item resolution (confirm missing, transfer in the register, register new, write off) and an open-discrepancy count that blocks closing |

## 3. Asset tags («پلاک اموال»)

| Need | Before | 1.1 |
| --- | --- | --- |
| Automatic tag numbering | exists (prefix + record digits) | kept |
| Official numbering convention per branch / class | missing | built: optional pattern `{prefix}{branch}-{class}-{seq}` in settings |
| Label printing (QR, A4 sheets) | exists | kept |

## 4. ATM fleet management

| Need | Before | 1.1 |
| --- | --- | --- |
| Operational status: in service, out of service, out of cash, maintenance, offline | missing | built: `asset.device_status` with a status-event ledger |
| Vendor maintenance contracts with SLA penalties | partial (contracts, coverage) | built: `maintenance_sla` terms per contract (restore hours, availability target, penalty per hour) and computed penalties |
| Preventive maintenance schedule → field-service visits | partial (field service has maintenance plans by CI) | built: one action creates PM plans for fleet devices (field service generates the work orders) |
| Firmware / OS and end-of-support tracking (Windows on ATMs) | partial (model EOL date only) | built: OS, firmware and OS end-of-support per device, EOS buckets in the fleet view |
| Cash-related incidents | missing | built: «بدون وجه نقد» opens an incident on the device's CI when asked |
| Availability KPI per region | missing | built: availability from the status ledger per device, branch, region and contract |
| ATM failure prediction | missing | built: rule-based risk score (incidents, downtime, age, EOS) as AI skill `itam.atm_failure_risk` |

## 5. Finance

| Need | Before | 1.1 |
| --- | --- | --- |
| Depreciation (straight-line / declining, residual value) | exists (monthly, Jalali months) | kept |
| Depreciation by Iranian fiscal year (1 Farvardin – end of Esfand), start-month convention | missing | built: `fiscalYearDepreciation` (opening, charge, closing per Jalali fiscal year; «از ماه بعد از بهره‌برداری») |
| Asset register report «دفتر اموال» with Excel export | missing | built: by fiscal year, branch, class; totals; Excel |
| Fixed-asset reconciliation with finance | partial (cost ledger in the financial module) | later: register totals vs. the GL import |
| Insurance | missing | built: policy number and end date on the asset |
| Leases | exists (lease contract and end) | kept |

## 6. Security and compliance

| Need | Before | 1.1 |
| --- | --- | --- |
| Disposal with secure data-wipe certificates | exists (sanitisation method, time, certificate number per item) | built: wipe certificate document (printable) per item and a guard that every data-bearing item has one |
| Asset sensitivity classification | missing | built: `asset.sensitivity` (عمومی، داخلی، محرمانه، سری) |
| Links to vulnerabilities and security incidents | partial (CI links) | later |
| Chain of custody | partial | built (see §2) |
| Periodic attestation by branch managers | missing | built: `branch_attestation` — open per branch, the manager confirms or lists exceptions and signs |

## 7. Software

| Need | Before | 1.1 |
| --- | --- | --- |
| Licence compliance (core banking, DB/OS, Microsoft agreements) | exists (entitlements, metrics, reconciliation) | kept; bank software models later |
| Installs and usage from discovery | exists | kept |

## 8. Reports

| Need | Before | 1.1 |
| --- | --- | --- |
| Excel exports | exists (every list) | kept; register and fleet export added |
| Fleet health, branch inventory, warranty/EOS expiry, audit discrepancies, asset value by unit | partial (asset dashboard) | built: fleet view, branch view, register totals by branch; analytics indicators later |
