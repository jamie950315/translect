//
//  ViewController.swift
//  Translect
//
//  Created by jamie chen on 2026/7/31.
//

import Cocoa
import SafariServices
import WebKit

let extensionBundleIdentifier = "\(Bundle.main.bundleIdentifier ?? "com.translect.safari").Extension"

class ViewController: NSViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.navigationDelegate = self

        self.webView.configuration.userContentController.add(self, name: "controller")

        self.webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { (state, error) in
            guard let state = state, error == nil else {
                self.showError(error?.localizedDescription ?? "Safari did not return the extension's state.")
                return
            }

            DispatchQueue.main.async {
                webView.evaluateJavaScript("show(\(state.isEnabled), true)") { _, error in
                    if let error {
                        self.showError(error.localizedDescription)
                    }
                }
            }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.body as? String == "open-preferences" else { return }

        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { error in
            DispatchQueue.main.async {
                if let error {
                    self.showError(error.localizedDescription)
                    return
                }
                NSApplication.shared.terminate(nil)
            }
        }
    }

    private func showError(_ message: String) {
        DispatchQueue.main.async {
            let alert = NSAlert()
            alert.messageText = "Unable to configure Translect in Safari"
            alert.informativeText = message
            alert.alertStyle = .warning
            if let window = self.view.window {
                alert.beginSheetModal(for: window)
            } else {
                alert.runModal()
            }
        }
    }

}
