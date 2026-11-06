import { AppProvider } from "@/components/app/AppContext";
import { MyForms } from "@/components/screens/MyForms";

export const metadata = { title: "My forms — Paper AI", robots: { index: false } };

export default function MyFormsPage() {
  return (
    <AppProvider>
      <MyForms />
    </AppProvider>
  );
}
