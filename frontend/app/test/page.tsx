"use client";

import { useState } from "react";

export default function TestPage() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <button
        onClick={() => setIsOpen(true)}
        className="px-6 py-3 bg-amber-500 hover:bg-amber-400 rounded-lg font-medium text-black"
      >
        打开测试弹窗
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setIsOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="max-w-md bg-white p-12 border rounded-lg">
              <h2 className="font-bold mb-4">测试弹窗</h2>
              <p className="mb-4">弹窗正常工作！</p>
              <button
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 bg-amber-500 rounded text-black font-medium"
              >
                关闭
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
