import type { Metadata } from "next";
import { Gaegu, Gowun_Dodum, Nanum_Pen_Script } from "next/font/google";

import { PreviewBanner } from "@/components/templates/preview-banner";
import { TemplateChrome } from "@/components/templates/template-chrome";
import { getCustomerTemplateContext } from "@/lib/customer-template-context";
import "./globals.css";
import "./templates/notebook.css";
import "./templates/chalkboard.css";

export const metadata: Metadata = {
  title: "bar-laam",
  description: "laam QR menu mobile web",
};

// 템플릿 폰트는 변수로만 등록한다. 해당 템플릿 CSS가 쓸 때만 브라우저가 파일을 받는다.
const gaegu = Gaegu({ weight: ["400", "700"], preload: false, variable: "--font-gaegu", display: "swap" });
const gowunDodum = Gowun_Dodum({ weight: "400", preload: false, variable: "--font-gowun-dodum", display: "swap" });
const nanumPen = Nanum_Pen_Script({ weight: "400", preload: false, variable: "--font-nanum-pen", display: "swap" });

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { template, isPreview } = await getCustomerTemplateContext();

  return (
    <html
      lang="ko"
      data-template={template}
      className={`${gaegu.variable} ${gowunDodum.variable} ${nanumPen.variable}`}
    >
      <body>
        {isPreview ? <PreviewBanner template={template} /> : null}
        <TemplateChrome template={template} />
        {children}
      </body>
    </html>
  );
}
