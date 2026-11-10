/**
 * 本文件由 tools/build-assets.mjs 从 models/*.json 生成，请勿手改。
 * 修改模型请编辑 models/<id>.json，然后运行 npm run models:build。
 */
export const MODELS = [
  {
    "id": "sdxl-lightning",
    "order": 10,
    "label": "默认 · 1024 快档",
    "repo": "stabilityai/stable-diffusion-xl-base-1.0 + ByteDance/SDXL-Lightning",
    "params": "3.5B + LoRA",
    "license": "OpenRAIL++",
    "licenseKind": "open",
    "gated": false,
    "gpus": 1,
    "tier": "fast",
    "size": 1024,
    "steps": 4,
    "cfg": 0,
    "negativeHint": "blurry, low quality, deformed, extra limbs",
    "sizeOptions": [
      768,
      1024,
      1152
    ],
    "runtime": "default",
    "pipeline": {
      "loader": "sdxl-lora",
      "base": "stabilityai/stable-diffusion-xl-base-1.0",
      "lora": {
        "repo": "ByteDance/SDXL-Lightning",
        "weight": "sdxl_lightning_4step_lora.safetensors"
      },
      "scheduler": {
        "type": "euler",
        "timestepSpacing": "trailing"
      },
      "variant": "fp16",
      "downloadGb": 6.78,
      "allowPatterns": [
        "model_index.json",
        "**/config.json",
        "**/*.json",
        "**/*.txt",
        "**/*.fp16.safetensors"
      ],
      "deviceMap": null
    },
    "measured": {
      "peakVramMb": 10347,
      "loadSeconds": 7.7,
      "steadySeconds": 6.2,
      "downloadGb": 6.78
    }
  },
  {
    "id": "sdxl-turbo",
    "order": 20,
    "label": "极速草稿",
    "repo": "stabilityai/sdxl-turbo",
    "params": "3.5B",
    "license": "非商用研究许可",
    "licenseKind": "restricted",
    "gated": false,
    "gpus": 1,
    "tier": "fast",
    "size": 512,
    "steps": 4,
    "cfg": 0,
    "negativeHint": "blurry, low quality",
    "sizeOptions": [
      512,
      768,
      1024
    ],
    "runtime": "default",
    "pipeline": {
      "loader": "sdxl",
      "base": "stabilityai/sdxl-turbo",
      "lora": null,
      "scheduler": null,
      "variant": "fp16",
      "downloadGb": 6.62,
      "allowPatterns": [
        "model_index.json",
        "**/config.json",
        "**/*.json",
        "**/*.txt",
        "**/*.fp16.safetensors"
      ],
      "deviceMap": null
    },
    "measured": {
      "peakVramMb": 7666,
      "loadSeconds": 4,
      "steadySeconds": 1.87,
      "downloadGb": 6.62
    }
  },
  {
    "id": "sdxl-base",
    "order": 30,
    "label": "标准 1024",
    "repo": "stabilityai/stable-diffusion-xl-base-1.0",
    "params": "3.5B",
    "license": "OpenRAIL++",
    "licenseKind": "open",
    "gated": false,
    "gpus": 1,
    "tier": "usable",
    "size": 1024,
    "steps": 25,
    "cfg": 7.5,
    "negativeHint": "blurry, low quality, deformed, extra limbs",
    "sizeOptions": [
      768,
      1024,
      1152
    ],
    "runtime": "default",
    "pipeline": {
      "loader": "sdxl",
      "base": "stabilityai/stable-diffusion-xl-base-1.0",
      "lora": null,
      "scheduler": null,
      "variant": "fp16",
      "downloadGb": 6.78,
      "allowPatterns": [
        "model_index.json",
        "**/config.json",
        "**/*.json",
        "**/*.txt",
        "**/*.fp16.safetensors"
      ],
      "deviceMap": null
    },
    "measured": {
      "peakVramMb": 9966,
      "loadSeconds": 5.8,
      "steadySeconds": 27.8,
      "downloadGb": 6.78
    }
  },
  {
    "id": "flux2-klein-4b",
    "order": 40,
    "label": "质量优先",
    "repo": "black-forest-labs/FLUX.2-klein-4B",
    "params": "3.88B",
    "license": "Apache-2.0",
    "licenseKind": "open",
    "gated": false,
    "gpus": 2,
    "tier": "fast",
    "size": 1024,
    "steps": 4,
    "cfg": 1,
    "negativeHint": "",
    "sizeOptions": [
      768,
      1024
    ],
    "runtime": "default",
    "pipeline": {
      "loader": "flux2",
      "base": "black-forest-labs/FLUX.2-klein-4B",
      "lora": null,
      "scheduler": null,
      "variant": "fp16",
      "downloadGb": 15.2,
      "allowPatterns": null,
      "deviceMap": "balanced"
    },
    "measured": {
      "peakVramMb": 7929,
      "loadSeconds": 28.2,
      "steadySeconds": 10.24,
      "downloadGb": 15.2
    }
  }
]

export const PRESETS = [
  {
    "id": "sdxl-lightning",
    "label": "默认 · 1024 快档",
    "repo": "stabilityai/stable-diffusion-xl-base-1.0 + ByteDance/SDXL-Lightning",
    "params": "3.5B + LoRA",
    "license": "OpenRAIL++",
    "licenseKind": "open",
    "gated": false,
    "gpus": 1,
    "downloadGb": 6.78,
    "size": 1024,
    "steps": 4,
    "cfg": 0,
    "peakVramMb": 10347,
    "loadSeconds": 7.7,
    "steadySeconds": 6.2,
    "tier": "fast",
    "negativeHint": "blurry, low quality, deformed, extra limbs",
    "sizeOptions": [
      768,
      1024,
      1152
    ],
    "pipeline": {
      "loader": "sdxl-lora",
      "base": "stabilityai/stable-diffusion-xl-base-1.0",
      "lora": {
        "repo": "ByteDance/SDXL-Lightning",
        "weight": "sdxl_lightning_4step_lora.safetensors"
      },
      "scheduler": {
        "type": "euler",
        "timestepSpacing": "trailing"
      },
      "variant": "fp16",
      "downloadGb": 6.78,
      "allowPatterns": [
        "model_index.json",
        "**/config.json",
        "**/*.json",
        "**/*.txt",
        "**/*.fp16.safetensors"
      ],
      "deviceMap": null
    }
  },
  {
    "id": "sdxl-turbo",
    "label": "极速草稿",
    "repo": "stabilityai/sdxl-turbo",
    "params": "3.5B",
    "license": "非商用研究许可",
    "licenseKind": "restricted",
    "gated": false,
    "gpus": 1,
    "downloadGb": 6.62,
    "size": 512,
    "steps": 4,
    "cfg": 0,
    "peakVramMb": 7666,
    "loadSeconds": 4,
    "steadySeconds": 1.87,
    "tier": "fast",
    "negativeHint": "blurry, low quality",
    "sizeOptions": [
      512,
      768,
      1024
    ],
    "pipeline": {
      "loader": "sdxl",
      "base": "stabilityai/sdxl-turbo",
      "lora": null,
      "scheduler": null,
      "variant": "fp16",
      "downloadGb": 6.62,
      "allowPatterns": [
        "model_index.json",
        "**/config.json",
        "**/*.json",
        "**/*.txt",
        "**/*.fp16.safetensors"
      ],
      "deviceMap": null
    }
  },
  {
    "id": "sdxl-base",
    "label": "标准 1024",
    "repo": "stabilityai/stable-diffusion-xl-base-1.0",
    "params": "3.5B",
    "license": "OpenRAIL++",
    "licenseKind": "open",
    "gated": false,
    "gpus": 1,
    "downloadGb": 6.78,
    "size": 1024,
    "steps": 25,
    "cfg": 7.5,
    "peakVramMb": 9966,
    "loadSeconds": 5.8,
    "steadySeconds": 27.8,
    "tier": "usable",
    "negativeHint": "blurry, low quality, deformed, extra limbs",
    "sizeOptions": [
      768,
      1024,
      1152
    ],
    "pipeline": {
      "loader": "sdxl",
      "base": "stabilityai/stable-diffusion-xl-base-1.0",
      "lora": null,
      "scheduler": null,
      "variant": "fp16",
      "downloadGb": 6.78,
      "allowPatterns": [
        "model_index.json",
        "**/config.json",
        "**/*.json",
        "**/*.txt",
        "**/*.fp16.safetensors"
      ],
      "deviceMap": null
    }
  },
  {
    "id": "flux2-klein-4b",
    "label": "质量优先",
    "repo": "black-forest-labs/FLUX.2-klein-4B",
    "params": "3.88B",
    "license": "Apache-2.0",
    "licenseKind": "open",
    "gated": false,
    "gpus": 2,
    "downloadGb": 15.2,
    "size": 1024,
    "steps": 4,
    "cfg": 1,
    "peakVramMb": 7929,
    "loadSeconds": 28.2,
    "steadySeconds": 10.24,
    "tier": "fast",
    "negativeHint": "",
    "sizeOptions": [
      768,
      1024
    ],
    "pipeline": {
      "loader": "flux2",
      "base": "black-forest-labs/FLUX.2-klein-4B",
      "lora": null,
      "scheduler": null,
      "variant": "fp16",
      "downloadGb": 15.2,
      "allowPatterns": null,
      "deviceMap": "balanced"
    }
  }
]
