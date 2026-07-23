import { SettingsTabs } from "@/features/settings/components/settings-tabs";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <SettingsTabs />
      </div>
      {children}
    </div>
  );
}
