package com.whl.quickjs.android;

/**
 * 原 wrapper-android-release.aar 提供的加载器（上游未公开源码，此处按调用约定重建）。
 * Provider 中仅调用 QuickJSLoader.init()，行为等价：装载 JNI 库。
 */
public final class QuickJSLoader {

    private QuickJSLoader() {
    }

    public static void init() {
        System.loadLibrary("quickjs-android-wrapper");
    }
}
