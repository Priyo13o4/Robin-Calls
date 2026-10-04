import type { Metadata } from "next";
import { ToastLab } from "./ToastLab";

/**
 * Style sandbox for the toast skins. Not linked from any nav: it exists to be
 * looked at while choosing a treatment, and it renders no chain data.
 */
export const metadata: Metadata = { title: "Toast lab", robots: { index: false, follow: false } };

export default function Page() {
  return <ToastLab />;
}
