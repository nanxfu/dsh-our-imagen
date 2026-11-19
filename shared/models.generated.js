/**
 * 本文件由 tools/build-assets.mjs 从 models/*.json 生成，请勿手改。
 * 修改模型请编辑 models/<id>.json，然后运行 npm run models:build。
 */
export const PUBLIC_PRESETS = [
  {
    "id": "sdxl-lightning",
    "label": "SDXL Lightning",
    "family": "SDXL",
    "short": "Lightning",
    "description": {
      "zh": "4 步极速出图，平衡画质与耗时",
      "en": "4-step fast generation, balanced quality"
    },
    "repo": "stabilityai/stable-diffusion-xl-base-1.0 + ByteDance/SDXL-Lightning",
    "params": "3.5B + LoRA",
    "license": "OpenRAIL++",
    "licenseKind": "open",
    "gated": false,
    "gpus": 1,
    "downloadGb": 6.78,
    "size": 1024,
    "steps": 4,
    "stepRange": null,
    "cfg": 0,
    "peakVramMb": 10347,
    "loadSeconds": 7.7,
    "steadySeconds": 6.2,
    "tier": "fast",
    "negativeHint": "blurry, low quality, deformed, extra limbs",
    "promptStyle": "concise",
    "qualityPrefix": "",
    "supportsChinese": false,
    "supportsImg2Img": true,
    "supportsReference": false,
    "supportsInpaint": true,
    "inpaintOnly": false,
    "supportsNegative": true,
    "sizeOptions": [
      768,
      1024,
      1152
    ]
  },
  {
    "id": "sana-sprint-1.6b",
    "label": "SANA-Sprint 1.6B",
    "family": "SANA",
    "short": "SANA-Sprint",
    "description": {
      "zh": "1.6B 线性 DiT，2 步超快 1024px 生成，轻量灵感探索",
      "en": "1.6B Linear DiT, 2-step ultra-fast 1024px generation"
    },
    "repo": "Efficient-Large-Model/Sana_Sprint_1.6B_1024px_diffusers",
    "params": "1.6B + Gemma-2-2B",
    "license": "Apache-2.0",
    "licenseKind": "open",
    "gated": false,
    "gpus": 1,
    "downloadGb": null,
    "size": 1024,
    "steps": 2,
    "stepRange": null,
    "cfg": 4.5,
    "peakVramMb": 10329,
    "loadSeconds": 35.2,
    "steadySeconds": 4.07,
    "tier": "fast",
    "negativeHint": "",
    "promptStyle": "natural",
    "qualityPrefix": "",
    "supportsChinese": false,
    "supportsImg2Img": false,
    "supportsReference": false,
    "supportsInpaint": false,
    "inpaintOnly": false,
    "supportsNegative": false,
    "sizeOptions": [
      768,
      1024
    ]
  },
  {
    "id": "z-image-turbo",
    "label": "Z-Image Turbo",
    "family": "Z-Image",
    "short": "Z-Image",
    "description": {
      "zh": "6B S3-DiT，8 步写实摄影、中英双语文字与局部重绘",
      "en": "6B S3-DiT, 8-step photorealism, bilingual text and inpainting"
    },
    "repo": "Tongyi-MAI/Z-Image-Turbo",
    "params": "6B S3-DiT + Qwen3-4B",
    "license": "Apache-2.0",
    "licenseKind": "open",
    "gated": false,
    "gpus": 1,
    "downloadGb": null,
    "size": 1024,
    "steps": 9,
    "stepRange": null,
    "cfg": 0,
    "peakVramMb": 12232,
    "loadSeconds": 131.7,
    "steadySeconds": 30.66,
    "tier": "fast",
    "negativeHint": "",
    "promptStyle": "natural",
    "qualityPrefix": "",
    "supportsChinese": true,
    "supportsImg2Img": true,
    "supportsReference": false,
    "supportsInpaint": true,
    "inpaintOnly": false,
    "supportsNegative": false,
    "providers": [
      "colab"
    ],
    "sizeOptions": [
      768,
      1024,
      1152
    ]
  },
  {
    "id": "qwen-image-2.1",
    "label": "Qwen-Image 2.1",
    "family": "Qwen",
    "short": "Qwen 2.1",
    "description": {
      "zh": "7B DiT + Qwen3-VL-8B（8 步 Turbo），强排版/多图编辑/透明背景（非商用）",
      "en": "7B DiT + Qwen3-VL-8B (8-step Turbo), strong typography, editing & RGBA (non-commercial)"
    },
    "repo": "Qwen/Qwen-Image-2.1-Turbo",
    "params": "7B DiT + Qwen3-VL-8B",
    "license": "Qwen Research License",
    "licenseKind": "restricted",
    "gated": false,
    "gpus": 1,
    "downloadGb": null,
    "size": 1024,
    "steps": 8,
    "stepRange": null,
    "cfg": 1,
    "peakVramMb": 16764,
    "loadSeconds": 95.9,
    "steadySeconds": 43.68,
    "tier": "fast",
    "negativeHint": "",
    "promptStyle": "natural",
    "qualityPrefix": "",
    "supportsChinese": true,
    "supportsImg2Img": false,
    "supportsReference": true,
    "supportsInpaint": false,
    "inpaintOnly": false,
    "supportsNegative": true,
    "providers": [
      "colab"
    ],
    "sizeOptions": [
      768,
      1024
    ]
  },
  {
    "id": "flux2-klein-4b",
    "label": "FLUX.2 Klein 4B",
    "family": "FLUX",
    "short": "Klein 4B",
    "description": {
      "zh": "下一代前沿架构，商业级质感与光影",
      "en": "Next-gen architecture, commercial grade"
    },
    "repo": "black-forest-labs/FLUX.2-klein-4B",
    "params": "3.88B",
    "license": "Apache-2.0",
    "licenseKind": "open",
    "gated": false,
    "gpus": 2,
    "downloadGb": null,
    "size": 1024,
    "steps": 4,
    "stepRange": null,
    "cfg": 1,
    "peakVramMb": 7929,
    "loadSeconds": 28.2,
    "steadySeconds": 10.24,
    "tier": "fast",
    "negativeHint": "",
    "promptStyle": "natural",
    "qualityPrefix": "",
    "supportsChinese": true,
    "supportsImg2Img": false,
    "supportsReference": true,
    "supportsInpaint": false,
    "inpaintOnly": false,
    "supportsNegative": false,
    "sizeOptions": [
      768,
      1024
    ]
  },
  {
    "id": "flux2-klein-9b",
    "label": "FLUX.2 Klein 9B",
    "family": "FLUX",
    "short": "Klein 9B",
    "description": {
      "zh": "9B 蒸馏编辑模型，4 步出图，非商用许可",
      "en": "9B distilled editing model, 4-step generation, non-commercial license"
    },
    "repo": "black-forest-labs/FLUX.2-klein-9B",
    "params": "9.08B",
    "license": "FLUX Non-Commercial License",
    "licenseKind": "restricted",
    "gated": true,
    "gpus": 1,
    "downloadGb": null,
    "size": 1024,
    "steps": 4,
    "stepRange": null,
    "cfg": 1,
    "peakVramMb": 18107,
    "loadSeconds": 98.9,
    "steadySeconds": 130.87,
    "tier": "fast",
    "negativeHint": "",
    "promptStyle": "natural",
    "qualityPrefix": "",
    "supportsChinese": false,
    "supportsImg2Img": false,
    "supportsReference": true,
    "supportsInpaint": false,
    "inpaintOnly": false,
    "supportsNegative": false,
    "providers": [
      "colab"
    ],
    "sizeOptions": [
      768,
      1024
    ]
  },
  {
    "id": "anima-turbo-v1.1",
    "label": "Anima Turbo v1.1",
    "family": "Anima",
    "short": "Anima Turbo",
    "description": {
      "zh": "8~12 步新一代二次元 DiT，支持自然语言与 Danbooru 标签",
      "en": "8–12 step next-gen anime DiT supporting natural language and tags"
    },
    "repo": "circlestone-labs/Anima",
    "params": "2B DiT + Qwen3-0.6B",
    "license": "CircleStone Labs Non-Commercial",
    "licenseKind": "restricted",
    "gated": false,
    "gpus": 1,
    "downloadGb": 5.25,
    "size": 1024,
    "steps": 10,
    "stepRange": null,
    "cfg": 1,
    "peakVramMb": 8469,
    "loadSeconds": 102.7,
    "steadySeconds": 21.56,
    "tier": "fast",
    "negativeHint": "",
    "promptStyle": "danbooru",
    "qualityPrefix": "masterpiece, best quality",
    "supportsChinese": false,
    "supportsImg2Img": false,
    "supportsReference": false,
    "supportsInpaint": false,
    "inpaintOnly": false,
    "supportsNegative": true,
    "sizeOptions": [
      768,
      1024,
      1152
    ]
  }
]

export const PRESETS = [
  {
    "id": "sdxl-lightning",
    "label": "SDXL Lightning",
    "family": "SDXL",
    "short": "Lightning",
    "description": {
      "zh": "4 步极速出图，平衡画质与耗时",
      "en": "4-step fast generation, balanced quality"
    },
    "repo": "stabilityai/stable-diffusion-xl-base-1.0 + ByteDance/SDXL-Lightning",
    "params": "3.5B + LoRA",
    "license": "OpenRAIL++",
    "licenseKind": "open",
    "gated": false,
    "gpus": 1,
    "downloadGb": 6.78,
    "size": 1024,
    "steps": 4,
    "stepRange": null,
    "cfg": 0,
    "peakVramMb": 10347,
    "loadSeconds": 7.7,
    "steadySeconds": 6.2,
    "tier": "fast",
    "negativeHint": "blurry, low quality, deformed, extra limbs",
    "promptStyle": "concise",
    "qualityPrefix": "",
    "supportsChinese": false,
    "supportsImg2Img": true,
    "supportsReference": false,
    "supportsInpaint": true,
    "inpaintOnly": false,
    "supportsNegative": true,
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
    "id": "sana-sprint-1.6b",
    "label": "SANA-Sprint 1.6B",
    "family": "SANA",
    "short": "SANA-Sprint",
    "description": {
      "zh": "1.6B 线性 DiT，2 步超快 1024px 生成，轻量灵感探索",
      "en": "1.6B Linear DiT, 2-step ultra-fast 1024px generation"
    },
    "repo": "Efficient-Large-Model/Sana_Sprint_1.6B_1024px_diffusers",
    "params": "1.6B + Gemma-2-2B",
    "license": "Apache-2.0",
    "licenseKind": "open",
    "gated": false,
    "gpus": 1,
    "downloadGb": null,
    "size": 1024,
    "steps": 2,
    "stepRange": null,
    "cfg": 4.5,
    "peakVramMb": 10329,
    "loadSeconds": 35.2,
    "steadySeconds": 4.07,
    "tier": "fast",
    "negativeHint": "",
    "promptStyle": "natural",
    "qualityPrefix": "",
    "supportsChinese": false,
    "supportsImg2Img": false,
    "supportsReference": false,
    "supportsInpaint": false,
    "inpaintOnly": false,
    "supportsNegative": false,
    "sizeOptions": [
      768,
      1024
    ],
    "pipeline": {
      "loader": "sana-sprint",
      "base": "Efficient-Large-Model/Sana_Sprint_1.6B_1024px_diffusers",
      "dtype": "bf16",
      "lora": null,
      "scheduler": null,
      "variant": null,
      "downloadGb": 9.07,
      "allowPatterns": [
        "model_index.json",
        "scheduler/**",
        "text_encoder/**",
        "tokenizer/**",
        "transformer/**",
        "vae/**"
      ],
      "deviceMap": null
    }
  },
  {
    "id": "z-image-turbo",
    "label": "Z-Image Turbo",
    "family": "Z-Image",
    "short": "Z-Image",
    "description": {
      "zh": "6B S3-DiT，8 步写实摄影、中英双语文字与局部重绘",
      "en": "6B S3-DiT, 8-step photorealism, bilingual text and inpainting"
    },
    "repo": "Tongyi-MAI/Z-Image-Turbo",
    "params": "6B S3-DiT + Qwen3-4B",
    "license": "Apache-2.0",
    "licenseKind": "open",
    "gated": false,
    "gpus": 1,
    "downloadGb": null,
    "size": 1024,
    "steps": 9,
    "stepRange": null,
    "cfg": 0,
    "peakVramMb": 12232,
    "loadSeconds": 131.7,
    "steadySeconds": 30.66,
    "tier": "fast",
    "negativeHint": "",
    "promptStyle": "natural",
    "qualityPrefix": "",
    "supportsChinese": true,
    "supportsImg2Img": true,
    "supportsReference": false,
    "supportsInpaint": true,
    "inpaintOnly": false,
    "supportsNegative": false,
    "providers": [
      "colab"
    ],
    "sizeOptions": [
      768,
      1024,
      1152
    ],
    "pipeline": {
      "loader": "zimage",
      "base": "Tongyi-MAI/Z-Image-Turbo",
      "dtype": "bf16",
      "cpuOffload": true,
      "lora": null,
      "scheduler": null,
      "variant": null,
      "downloadGb": 30.64,
      "allowPatterns": [
        "model_index.json",
        "scheduler/**",
        "text_encoder/**",
        "tokenizer/**",
        "transformer/**",
        "vae/**"
      ],
      "deviceMap": null
    }
  },
  {
    "id": "qwen-image-2.1",
    "label": "Qwen-Image 2.1",
    "family": "Qwen",
    "short": "Qwen 2.1",
    "description": {
      "zh": "7B DiT + Qwen3-VL-8B（8 步 Turbo），强排版/多图编辑/透明背景（非商用）",
      "en": "7B DiT + Qwen3-VL-8B (8-step Turbo), strong typography, editing & RGBA (non-commercial)"
    },
    "repo": "Qwen/Qwen-Image-2.1-Turbo",
    "params": "7B DiT + Qwen3-VL-8B",
    "license": "Qwen Research License",
    "licenseKind": "restricted",
    "gated": false,
    "gpus": 1,
    "downloadGb": null,
    "size": 1024,
    "steps": 8,
    "stepRange": null,
    "cfg": 1,
    "peakVramMb": 16764,
    "loadSeconds": 95.9,
    "steadySeconds": 43.68,
    "tier": "fast",
    "negativeHint": "",
    "promptStyle": "natural",
    "qualityPrefix": "",
    "supportsChinese": true,
    "supportsImg2Img": false,
    "supportsReference": true,
    "supportsInpaint": false,
    "inpaintOnly": false,
    "supportsNegative": true,
    "providers": [
      "colab"
    ],
    "sizeOptions": [
      768,
      1024
    ],
    "pipeline": {
      "loader": "qwen-image-2.1",
      "base": "Qwen/Qwen-Image-2.1-Turbo",
      "dtype": "bf16",
      "cpuOffload": true,
      "lora": null,
      "scheduler": null,
      "variant": null,
      "downloadGb": 30.26,
      "allowPatterns": [
        "model_index.json",
        "processor/**",
        "scheduler/**",
        "text_encoder/**",
        "transformer/**",
        "vae/**"
      ],
      "deviceMap": null
    }
  },
  {
    "id": "flux2-klein-4b",
    "label": "FLUX.2 Klein 4B",
    "family": "FLUX",
    "short": "Klein 4B",
    "description": {
      "zh": "下一代前沿架构，商业级质感与光影",
      "en": "Next-gen architecture, commercial grade"
    },
    "repo": "black-forest-labs/FLUX.2-klein-4B",
    "params": "3.88B",
    "license": "Apache-2.0",
    "licenseKind": "open",
    "gated": false,
    "gpus": 2,
    "downloadGb": null,
    "size": 1024,
    "steps": 4,
    "stepRange": null,
    "cfg": 1,
    "peakVramMb": 7929,
    "loadSeconds": 28.2,
    "steadySeconds": 10.24,
    "tier": "fast",
    "negativeHint": "",
    "promptStyle": "natural",
    "qualityPrefix": "",
    "supportsChinese": true,
    "supportsImg2Img": false,
    "supportsReference": true,
    "supportsInpaint": false,
    "inpaintOnly": false,
    "supportsNegative": false,
    "sizeOptions": [
      768,
      1024
    ],
    "pipeline": {
      "loader": "flux2",
      "base": "black-forest-labs/FLUX.2-klein-4B",
      "lora": null,
      "scheduler": null,
      "variant": null,
      "downloadGb": 16,
      "allowPatterns": [
        "model_index.json",
        "scheduler/**",
        "text_encoder/**",
        "tokenizer/**",
        "transformer/**",
        "vae/**"
      ],
      "deviceMap": "balanced"
    }
  },
  {
    "id": "flux2-klein-9b",
    "label": "FLUX.2 Klein 9B",
    "family": "FLUX",
    "short": "Klein 9B",
    "description": {
      "zh": "9B 蒸馏编辑模型，4 步出图，非商用许可",
      "en": "9B distilled editing model, 4-step generation, non-commercial license"
    },
    "repo": "black-forest-labs/FLUX.2-klein-9B",
    "params": "9.08B",
    "license": "FLUX Non-Commercial License",
    "licenseKind": "restricted",
    "gated": true,
    "gpus": 1,
    "downloadGb": null,
    "size": 1024,
    "steps": 4,
    "stepRange": null,
    "cfg": 1,
    "peakVramMb": 18107,
    "loadSeconds": 98.9,
    "steadySeconds": 130.87,
    "tier": "fast",
    "negativeHint": "",
    "promptStyle": "natural",
    "qualityPrefix": "",
    "supportsChinese": false,
    "supportsImg2Img": false,
    "supportsReference": true,
    "supportsInpaint": false,
    "inpaintOnly": false,
    "supportsNegative": false,
    "providers": [
      "colab"
    ],
    "sizeOptions": [
      768,
      1024
    ],
    "pipeline": {
      "loader": "flux2",
      "base": "black-forest-labs/FLUX.2-klein-9B",
      "dtype": "bf16",
      "cpuOffload": true,
      "lora": null,
      "scheduler": null,
      "variant": null,
      "downloadGb": 34.7,
      "allowPatterns": [
        "model_index.json",
        "scheduler/**",
        "text_encoder/**",
        "tokenizer/**",
        "transformer/**",
        "vae/**"
      ],
      "deviceMap": "balanced"
    }
  },
  {
    "id": "anima-turbo-v1.1",
    "label": "Anima Turbo v1.1",
    "family": "Anima",
    "short": "Anima Turbo",
    "description": {
      "zh": "8~12 步新一代二次元 DiT，支持自然语言与 Danbooru 标签",
      "en": "8–12 step next-gen anime DiT supporting natural language and tags"
    },
    "repo": "circlestone-labs/Anima",
    "params": "2B DiT + Qwen3-0.6B",
    "license": "CircleStone Labs Non-Commercial",
    "licenseKind": "restricted",
    "gated": false,
    "gpus": 1,
    "downloadGb": 5.25,
    "size": 1024,
    "steps": 10,
    "stepRange": null,
    "cfg": 1,
    "peakVramMb": 8469,
    "loadSeconds": 102.7,
    "steadySeconds": 21.56,
    "tier": "fast",
    "negativeHint": "",
    "promptStyle": "danbooru",
    "qualityPrefix": "masterpiece, best quality",
    "supportsChinese": false,
    "supportsImg2Img": false,
    "supportsReference": false,
    "supportsInpaint": false,
    "inpaintOnly": false,
    "supportsNegative": true,
    "sizeOptions": [
      768,
      1024,
      1152
    ],
    "pipeline": {
      "loader": "anima",
      "base": "circlestone-labs/Anima",
      "weight": "split_files/diffusion_models/anima-turbo-v1.1.safetensors",
      "textEncoder": {
        "repo": "circlestone-labs/Anima",
        "weight": "split_files/text_encoders/qwen_3_06b_base.safetensors"
      },
      "vae": {
        "repo": "Qwen/Qwen-Image",
        "subfolder": "vae"
      },
      "tokenizers": {
        "repo": "hugging-apps/anima-light-lavender-demo",
        "repoType": "space"
      },
      "dtype": "auto",
      "shift": 3,
      "downloadGb": 5.25,
      "allowPatterns": null,
      "deviceMap": null,
      "variant": null,
      "lora": null,
      "scheduler": null
    }
  }
]
