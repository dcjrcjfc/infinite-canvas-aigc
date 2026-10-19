# TapNow workbench reference assets

Reference: https://app.tapnow.ai/canvas/779263ba-d6ec-44db-94be-6791b611d246

- logo.webp: https://fe-assets.tapnow.media/d5c0e638e1c74b98a438e853f912cbdd17936061/tap_logo.webp
- assistant-mark.png: exact 24x24 crop at (1488,258) from the user supplied screenshot, preserved in .local/tapnow-workbench/source.png. No recreated glyph.
- inter-400.woff2 (variable regular/semibold): Google Fonts Inter, https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2 (the same variable font is returned for both requested weights). Font CSS URL was present in the reference document.
- Standard controls: existing Lucide library. The reference uses matching outline symbols; custom branding remains a bitmap asset.

All runtime assets are served locally. User names, account credits, and community backend are not copied. The top number reports this project's configured available models.

Inter license: SIL Open Font License 1.1, retained in client/licenses/inter-OFL.txt and the public THIRD_PARTY_NOTICES.txt.
- canvas-grid.png: exact 20x20 repeating tile from user screenshot region (100,100)-(120,120); retained as pixels and positioned with the camera to avoid compositor blur.
