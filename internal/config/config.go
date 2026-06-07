package config

import "os"

type Config struct {
	AdminAddr          string
	DBDriver           string
	DBDSN              string
	SiliconFlowAPIKey  string
	SiliconFlowBaseURL string
	SiliconFlowModel   string
	ImageAPIEndpoint   string
	ImageAPIKey        string
}

func Default() Config {
	return Config{
		AdminAddr:          ":8086",
		DBDriver:           "sqlite",
		DBDSN:              "var/db/app.sqlite",
		SiliconFlowBaseURL: "https://api.siliconflow.cn/v1",
		ImageAPIEndpoint: "",
	}
}

func LoadFromEnv() Config {
	cfg := Default()

	if v := os.Getenv("ADMIN_ADDR"); v != "" {
		cfg.AdminAddr = v
	}
	if v := os.Getenv("DB_DRIVER"); v != "" {
		cfg.DBDriver = v
	}
	if v := os.Getenv("DB_DSN"); v != "" {
		cfg.DBDSN = v
	}
	if v := os.Getenv("DATABASE_URL"); v != "" && cfg.DBDSN == "var/db/app.sqlite" {
		cfg.DBDriver = "pgx"
		cfg.DBDSN = v
	}
	if v := os.Getenv("SILICONFLOW_API_KEY"); v != "" {
		cfg.SiliconFlowAPIKey = v
	}
	if v := os.Getenv("SILICONFLOW_BASE_URL"); v != "" {
		cfg.SiliconFlowBaseURL = v
	}
	if v := os.Getenv("SILICONFLOW_MODEL"); v != "" {
		cfg.SiliconFlowModel = v
	}
	if v := os.Getenv("IMAGE_API_ENDPOINT"); v != "" {
		cfg.ImageAPIEndpoint = v
	}
	if v := os.Getenv("IMAGE_API_KEY"); v != "" {
		cfg.ImageAPIKey = v
	}

	return cfg
}
