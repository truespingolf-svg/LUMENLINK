# LUMENLINK Firestore Security Specification

## 1. Data Invariants
1. Every document ID (`showKey`, `deviceId`) must match `^[a-zA-Z0-9_\-]+$` and be at most 128 characters.
2. No Audience Device can exist without an existing parent `/liveShows/{showKey}` document (`exists()` check on `create`).
3. Every `AudienceDevice` document must bind `id == deviceId` and `showKey == showKey` immutably after creation (`joinedAtMs` is also immutable).
4. `LiveShow` lighting values stay strictly typed and bounded (`masterIntensity` in `0..100`, bounded strings/lists).
5. No PII (emails, phone numbers, addresses, credentials) is stored in `/liveShows` or `/devices`.
6. Collection-wide `list` on `/liveShows` is disabled (`allow list: if false`); audience clients read only the exact show key they join.

## 2. Adversarial Payloads Checked Against Rules
1. Ghost/shadow field on LiveShow (`isAdmin: true`) -> rejected by `hasOnly(...)`.
2. Ghost/shadow field on AudienceDevice (`secretRole: 'host'`) -> rejected by `hasOnly(...)`.
3. Oversized `showKey` (>128 chars) or invalid chars (`../evil`) -> rejected by `isValidId()`.
4. Oversized `device.name` (>80 chars) -> rejected by `data.name.size() <= 80`.
5. Negative or >100 `masterIntensity` -> rejected by range check `0..100`.
6. Orphaned device written to non-existent `/liveShows/FAKE/devices/d1` -> rejected by parent `exists()`.
7. Spoofed `device.id` not matching path `deviceId` -> rejected by `data.id == deviceId`.
8. Mutating immutable `joinedAtMs` or `showKey` on device update -> rejected by equality check.
9. Invalid `deviceType` or `status` enum -> rejected by `in [...]` check.
10. Normalized coordinate `x` or `y` outside `[0, 1]` -> rejected by coordinate range check.
11. Unbounded `layers` array (>32 layers) -> rejected by `.size() <= 32`.
12. Collection-wide scrape via `list` on `/liveShows` -> rejected (`allow list: if false`).
