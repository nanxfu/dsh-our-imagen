/**
 * 本文件由 tools/build-assets.mjs 从 models/*.json 生成，请勿手改。
 * 修改模型请编辑 models/<id>.json，然后运行 npm run models:build。
 */
export const MODELS = [
  {
    "id": "sdxl-lightning",
    "order": 10,
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
    "tier": "fast",
    "size": 1024,
    "steps": 4,
    "cfg": 0,
    "negativeHint": "blurry, low quality, deformed, extra limbs",
    "promptStyle": "concise",
    "qualityPrefix": "",
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
    "id": "hyper-sdxl-8step",
    "order": 15,
    "label": "Hyper-SDXL 8-Step",
    "family": "SDXL",
    "short": "Hyper-SD 8",
    "description": {
      "zh": "8 步蒸馏，速度与画质的折中",
      "en": "8-step distilled balance of speed and quality"
    },
    "repo": "stabilityai/stable-diffusion-xl-base-1.0 + ByteDance/Hyper-SD",
    "params": "3.5B + LoRA",
    "license": "OpenRAIL++-M",
    "licenseKind": "open",
    "gated": false,
    "gpus": 1,
    "tier": "fast",
    "size": 1024,
    "steps": 8,
    "cfg": 0,
    "negativeHint": "blurry, low quality, deformed",
    "promptStyle": "concise",
    "qualityPrefix": "",
    "sizeOptions": [
      768,
      1024
    ],
    "runtime": "default",
    "pipeline": {
      "loader": "sdxl-lora",
      "base": "stabilityai/stable-diffusion-xl-base-1.0",
      "lora": {
        "repo": "ByteDance/Hyper-SD",
        "weight": "Hyper-SDXL-8steps-lora.safetensors"
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
      "loadSeconds": 14.3,
      "steadySeconds": 7.74,
      "downloadGb": 7.35
    }
  },
  {
    "id": "sdxl-turbo",
    "order": 20,
    "label": "SDXL Turbo",
    "family": "SDXL",
    "short": "Turbo",
    "description": {
      "zh": "实时低延迟，适合构图灵感与草稿速探",
      "en": "Real-time low latency, ideal for drafting"
    },
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
    "promptStyle": "concise",
    "qualityPrefix": "",
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
    "id": "playground-v2.5",
    "order": 25,
    "label": "Playground v2.5",
    "family": "SDXL",
    "short": "Playground 2.5",
    "description": {
      "zh": "美学取向，画面干净耐看",
      "en": "Aesthetic-first, clean and polished"
    },
    "repo": "playgroundai/playground-v2.5-1024px-aesthetic",
    "params": "3.5B",
    "license": "Playground v2.5 Community License",
    "licenseKind": "open",
    "gated": false,
    "gpus": 1,
    "tier": "usable",
    "size": 1024,
    "steps": 30,
    "cfg": 3,
    "negativeHint": "ugly, deformed, noisy, blurry, distorted",
    "promptStyle": "natural",
    "qualityPrefix": "",
    "sizeOptions": [
      768,
      1024
    ],
    "runtime": "default",
    "pipeline": {
      "loader": "sdxl",
      "base": "playgroundai/playground-v2.5-1024px-aesthetic",
      "lora": null,
      "scheduler": null,
      "variant": "fp16",
      "downloadGb": 6.6,
      "allowPatterns": [
        "model_index.json",
        "**/config.json",
        "**/*.json",
        "**/*.txt",
        "unet/*.fp16.safetensors",
        "text_encoder/model.fp16.safetensors",
        "text_encoder_2/model.fp16.safetensors",
        "vae/*.fp16.safetensors"
      ],
      "deviceMap": null
    },
    "measured": {
      "peakVramMb": 9967,
      "loadSeconds": 5.7,
      "steadySeconds": 28.34,
      "downloadGb": 6.46
    }
  },
  {
    "id": "sdxl-base",
    "order": 30,
    "label": "SDXL Base 1.0",
    "family": "SDXL",
    "short": "Base 1.0",
    "description": {
      "zh": "25 步原生精绘，结构完整细节扎实",
      "en": "25-step native base, rich structural details"
    },
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
    "promptStyle": "natural",
    "qualityPrefix": "",
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
    "id": "realvis-v5",
    "order": 35,
    "label": "RealVisXL V5.0",
    "family": "SDXL",
    "short": "RealVis V5",
    "description": {
      "zh": "超写实摄影质感，人像与皮肤细节",
      "en": "Photorealistic detail for portraits and skin"
    },
    "repo": "SG161222/RealVisXL_V5.0",
    "params": "3.5B",
    "license": "OpenRAIL++",
    "licenseKind": "open",
    "gated": false,
    "gpus": 1,
    "tier": "usable",
    "size": 1024,
    "steps": 25,
    "cfg": 5,
    "negativeHint": "blurry, low quality, deformed, extra limbs, ugly, bad anatomy",
    "promptStyle": "natural",
    "qualityPrefix": "",
    "sizeOptions": [
      768,
      1024
    ],
    "runtime": "default",
    "pipeline": {
      "loader": "sdxl",
      "base": "SG161222/RealVisXL_V5.0",
      "lora": null,
      "scheduler": null,
      "variant": "fp16",
      "downloadGb": 6.6,
      "allowPatterns": [
        "model_index.json",
        "**/config.json",
        "**/*.json",
        "**/*.txt",
        "unet/*.fp16.safetensors",
        "text_encoder/model.fp16.safetensors",
        "text_encoder_2/model.fp16.safetensors",
        "vae/*.fp16.safetensors"
      ],
      "deviceMap": null
    },
    "measured": {
      "peakVramMb": 9967,
      "loadSeconds": 5.2,
      "steadySeconds": 24.53,
      "downloadGb": 6.46
    }
  },
  {
    "id": "flux2-klein-4b",
    "order": 40,
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
    "tier": "fast",
    "size": 1024,
    "steps": 4,
    "cfg": 1,
    "negativeHint": "",
    "promptStyle": "natural",
    "qualityPrefix": "",
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
  },
  {
    "id": "animagine-xl-3.1",
    "order": 45,
    "label": "Animagine XL 3.1",
    "family": "SDXL",
    "short": "Animagine 3.1",
    "description": {
      "zh": "二次元插画与角色表现",
      "en": "Anime illustration and character art"
    },
    "repo": "cagliostrolab/animagine-xl-3.1",
    "params": "3.5B",
    "license": "OpenRAIL++",
    "licenseKind": "open",
    "gated": false,
    "gpus": 1,
    "tier": "usable",
    "size": 1024,
    "steps": 28,
    "cfg": 7,
    "negativeHint": "nsfw, lowres, (bad), text, error, fewer, extra, missing, worst quality, jpeg artifacts, low quality, watermark, unfinished, displeasing, oldest, early, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]",
    "promptStyle": "danbooru",
    "qualityPrefix": "masterpiece, best quality, highres",
    "sizeOptions": [
      768,
      1024
    ],
    "runtime": "default",
    "pipeline": {
      "loader": "sdxl",
      "base": "cagliostrolab/animagine-xl-3.1",
      "lora": null,
      "scheduler": null,
      "variant": null,
      "downloadGb": 6.5,
      "allowPatterns": [
        "model_index.json",
        "**/config.json",
        "**/*.json",
        "**/*.txt",
        "unet/*.safetensors",
        "text_encoder/model.safetensors",
        "text_encoder_2/model.safetensors",
        "vae/*.safetensors"
      ],
      "deviceMap": null
    },
    "measured": {
      "peakVramMb": 9176,
      "loadSeconds": 4.8,
      "steadySeconds": 26.17,
      "downloadGb": 6.46
    }
  },
  {
    "id": "anima-light-lavender",
    "order": 55,
    "label": "Anima Light Lavender",
    "family": "Anima",
    "short": "Lavender",
    "description": {
      "zh": "长自然语言驱动的二次元插画，Cosmos-Predict2 2B 底座",
      "en": "Anime illustration driven by long natural-language prompts"
    },
    "repo": "Johnny-Z/Anima-Light-Lavender",
    "params": "2B DiT + Qwen3-0.6B",
    "license": "CircleStone Labs Non-Commercial",
    "licenseKind": "restricted",
    "gated": false,
    "gpus": 1,
    "tier": "usable",
    "size": 1024,
    "steps": 25,
    "cfg": 4,
    "negativeHint": "",
    "promptStyle": "natural",
    "qualityPrefix": "",
    "sizeOptions": [
      768,
      1024,
      1152
    ],
    "runtime": "default",
    "pipeline": {
      "loader": "anima",
      "base": "Johnny-Z/Anima-Light-Lavender",
      "weight": "anima-light-lavender.safetensors",
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
      "downloadGb": 5.6,
      "allowPatterns": null,
      "deviceMap": null,
      "variant": null,
      "lora": null,
      "scheduler": null
    },
    "measured": {
      "peakVramMb": 8470,
      "loadSeconds": 43.5,
      "steadySeconds": 80.64,
      "downloadGb": 5.25
    }
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
    "cfg": 0,
    "peakVramMb": 10347,
    "loadSeconds": 7.7,
    "steadySeconds": 6.2,
    "tier": "fast",
    "negativeHint": "blurry, low quality, deformed, extra limbs",
    "promptStyle": "concise",
    "qualityPrefix": "",
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
    "id": "hyper-sdxl-8step",
    "label": "Hyper-SDXL 8-Step",
    "family": "SDXL",
    "short": "Hyper-SD 8",
    "description": {
      "zh": "8 步蒸馏，速度与画质的折中",
      "en": "8-step distilled balance of speed and quality"
    },
    "repo": "stabilityai/stable-diffusion-xl-base-1.0 + ByteDance/Hyper-SD",
    "params": "3.5B + LoRA",
    "license": "OpenRAIL++-M",
    "licenseKind": "open",
    "gated": false,
    "gpus": 1,
    "downloadGb": 7.35,
    "size": 1024,
    "steps": 8,
    "cfg": 0,
    "peakVramMb": 10347,
    "loadSeconds": 14.3,
    "steadySeconds": 7.74,
    "tier": "fast",
    "negativeHint": "blurry, low quality, deformed",
    "promptStyle": "concise",
    "qualityPrefix": "",
    "sizeOptions": [
      768,
      1024
    ],
    "pipeline": {
      "loader": "sdxl-lora",
      "base": "stabilityai/stable-diffusion-xl-base-1.0",
      "lora": {
        "repo": "ByteDance/Hyper-SD",
        "weight": "Hyper-SDXL-8steps-lora.safetensors"
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
    "label": "SDXL Turbo",
    "family": "SDXL",
    "short": "Turbo",
    "description": {
      "zh": "实时低延迟，适合构图灵感与草稿速探",
      "en": "Real-time low latency, ideal for drafting"
    },
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
    "promptStyle": "concise",
    "qualityPrefix": "",
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
    "id": "playground-v2.5",
    "label": "Playground v2.5",
    "family": "SDXL",
    "short": "Playground 2.5",
    "description": {
      "zh": "美学取向，画面干净耐看",
      "en": "Aesthetic-first, clean and polished"
    },
    "repo": "playgroundai/playground-v2.5-1024px-aesthetic",
    "params": "3.5B",
    "license": "Playground v2.5 Community License",
    "licenseKind": "open",
    "gated": false,
    "gpus": 1,
    "downloadGb": 6.46,
    "size": 1024,
    "steps": 30,
    "cfg": 3,
    "peakVramMb": 9967,
    "loadSeconds": 5.7,
    "steadySeconds": 28.34,
    "tier": "usable",
    "negativeHint": "ugly, deformed, noisy, blurry, distorted",
    "promptStyle": "natural",
    "qualityPrefix": "",
    "sizeOptions": [
      768,
      1024
    ],
    "pipeline": {
      "loader": "sdxl",
      "base": "playgroundai/playground-v2.5-1024px-aesthetic",
      "lora": null,
      "scheduler": null,
      "variant": "fp16",
      "downloadGb": 6.6,
      "allowPatterns": [
        "model_index.json",
        "**/config.json",
        "**/*.json",
        "**/*.txt",
        "unet/*.fp16.safetensors",
        "text_encoder/model.fp16.safetensors",
        "text_encoder_2/model.fp16.safetensors",
        "vae/*.fp16.safetensors"
      ],
      "deviceMap": null
    }
  },
  {
    "id": "sdxl-base",
    "label": "SDXL Base 1.0",
    "family": "SDXL",
    "short": "Base 1.0",
    "description": {
      "zh": "25 步原生精绘，结构完整细节扎实",
      "en": "25-step native base, rich structural details"
    },
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
    "promptStyle": "natural",
    "qualityPrefix": "",
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
    "id": "realvis-v5",
    "label": "RealVisXL V5.0",
    "family": "SDXL",
    "short": "RealVis V5",
    "description": {
      "zh": "超写实摄影质感，人像与皮肤细节",
      "en": "Photorealistic detail for portraits and skin"
    },
    "repo": "SG161222/RealVisXL_V5.0",
    "params": "3.5B",
    "license": "OpenRAIL++",
    "licenseKind": "open",
    "gated": false,
    "gpus": 1,
    "downloadGb": 6.46,
    "size": 1024,
    "steps": 25,
    "cfg": 5,
    "peakVramMb": 9967,
    "loadSeconds": 5.2,
    "steadySeconds": 24.53,
    "tier": "usable",
    "negativeHint": "blurry, low quality, deformed, extra limbs, ugly, bad anatomy",
    "promptStyle": "natural",
    "qualityPrefix": "",
    "sizeOptions": [
      768,
      1024
    ],
    "pipeline": {
      "loader": "sdxl",
      "base": "SG161222/RealVisXL_V5.0",
      "lora": null,
      "scheduler": null,
      "variant": "fp16",
      "downloadGb": 6.6,
      "allowPatterns": [
        "model_index.json",
        "**/config.json",
        "**/*.json",
        "**/*.txt",
        "unet/*.fp16.safetensors",
        "text_encoder/model.fp16.safetensors",
        "text_encoder_2/model.fp16.safetensors",
        "vae/*.fp16.safetensors"
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
    "downloadGb": 15.2,
    "size": 1024,
    "steps": 4,
    "cfg": 1,
    "peakVramMb": 7929,
    "loadSeconds": 28.2,
    "steadySeconds": 10.24,
    "tier": "fast",
    "negativeHint": "",
    "promptStyle": "natural",
    "qualityPrefix": "",
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
  },
  {
    "id": "animagine-xl-3.1",
    "label": "Animagine XL 3.1",
    "family": "SDXL",
    "short": "Animagine 3.1",
    "description": {
      "zh": "二次元插画与角色表现",
      "en": "Anime illustration and character art"
    },
    "repo": "cagliostrolab/animagine-xl-3.1",
    "params": "3.5B",
    "license": "OpenRAIL++",
    "licenseKind": "open",
    "gated": false,
    "gpus": 1,
    "downloadGb": 6.46,
    "size": 1024,
    "steps": 28,
    "cfg": 7,
    "peakVramMb": 9176,
    "loadSeconds": 4.8,
    "steadySeconds": 26.17,
    "tier": "usable",
    "negativeHint": "nsfw, lowres, (bad), text, error, fewer, extra, missing, worst quality, jpeg artifacts, low quality, watermark, unfinished, displeasing, oldest, early, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]",
    "promptStyle": "danbooru",
    "qualityPrefix": "masterpiece, best quality, highres",
    "sizeOptions": [
      768,
      1024
    ],
    "pipeline": {
      "loader": "sdxl",
      "base": "cagliostrolab/animagine-xl-3.1",
      "lora": null,
      "scheduler": null,
      "variant": null,
      "downloadGb": 6.5,
      "allowPatterns": [
        "model_index.json",
        "**/config.json",
        "**/*.json",
        "**/*.txt",
        "unet/*.safetensors",
        "text_encoder/model.safetensors",
        "text_encoder_2/model.safetensors",
        "vae/*.safetensors"
      ],
      "deviceMap": null
    }
  },
  {
    "id": "anima-light-lavender",
    "label": "Anima Light Lavender",
    "family": "Anima",
    "short": "Lavender",
    "description": {
      "zh": "长自然语言驱动的二次元插画，Cosmos-Predict2 2B 底座",
      "en": "Anime illustration driven by long natural-language prompts"
    },
    "repo": "Johnny-Z/Anima-Light-Lavender",
    "params": "2B DiT + Qwen3-0.6B",
    "license": "CircleStone Labs Non-Commercial",
    "licenseKind": "restricted",
    "gated": false,
    "gpus": 1,
    "downloadGb": 5.25,
    "size": 1024,
    "steps": 25,
    "cfg": 4,
    "peakVramMb": 8470,
    "loadSeconds": 43.5,
    "steadySeconds": 80.64,
    "tier": "usable",
    "negativeHint": "",
    "promptStyle": "natural",
    "qualityPrefix": "",
    "sizeOptions": [
      768,
      1024,
      1152
    ],
    "pipeline": {
      "loader": "anima",
      "base": "Johnny-Z/Anima-Light-Lavender",
      "weight": "anima-light-lavender.safetensors",
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
      "downloadGb": 5.6,
      "allowPatterns": null,
      "deviceMap": null,
      "variant": null,
      "lora": null,
      "scheduler": null
    }
  }
]
