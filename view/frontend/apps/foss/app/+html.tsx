import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

const themeScript = `(function(){try{var s=JSON.parse(localStorage.getItem("hydris-theme")||"{}");var p=s&&s.state&&s.state.preference;if(p!=="light")document.documentElement.classList.add("dark")}catch(e){document.documentElement.classList.add("dark")}})()`;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <ScrollViewStyleReset />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
