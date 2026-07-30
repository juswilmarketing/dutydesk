export interface AsycudaHeader {
  officeCode: string;
  officeName: string;
  declarationType: string;
  procedureCode: string;
  consigneeCode: string;
  consigneeName: string;
  declarantCode: string;
  declarantName: string;
  referenceNumber: string;
  exporterCode: string;
  exporterName: string;
  exporterAddress2: string;
  exporterAddress3: string;
  exporterAddress4: string;
  exportCountryCode: string;
  exportCountryName: string;
  vesselName: string;
  vesselNat: string;
  transportMode: string;
  borderOfficeCode: string;
  borderOfficeName: string;
  containerFlag: string;
  incoterm: string;
  bankCode: string;
  paymentMode: string;
  currencyCode: string;
  currencyName: string;
  currencyRate: string;
  totalPackages: string;
  pkgKind: string;
  marksText: string;
  totalGrossWeight: string;
  summaryDecl: string;
  invoiceTypeCode: string;
  supplierInvoiceNbr: string;
  supplierInvoiceDate: string;
}

export interface AsycudaItem {
  desc: string;
  tariff_code: string;
  cif: string;
  grossWeight: string;
  netWeight: string;
  originCode: string;
  itemPkgs: string;
  suppUnitCode: string;
  suppUnitName: string;
  suppQty: string;
}

export const blankAsycudaHeader = (): AsycudaHeader => ({
  officeCode: "POS",
  officeName: "Port of Spain",
  declarationType: "IM",
  procedureCode: "4",
  consigneeCode: "",
  consigneeName: "",
  declarantCode: "BR0257",
  declarantName: "MARIO A L GRANADO",
  referenceNumber: "",
  exporterCode: "",
  exporterName: "",
  exporterAddress2: "",
  exporterAddress3: "",
  exporterAddress4: "",
  exportCountryCode: "PA",
  exportCountryName: "Panama",
  vesselName: "",
  vesselNat: "AG",
  transportMode: "1",
  borderOfficeCode: "TTPTS",
  borderOfficeName: "Point Lisas",
  containerFlag: "false",
  incoterm: "FOB",
  bankCode: "01",
  paymentMode: "CASH",
  currencyCode: "TTD",
  currencyName: "No foreign currency",
  currencyRate: "1.00",
  totalPackages: "",
  pkgKind: "CT",
  marksText: "AS ADDRESSED",
  totalGrossWeight: "",
  summaryDecl: "",
  invoiceTypeCode: "IV05",
  supplierInvoiceNbr: "",
  supplierInvoiceDate: "0/0/00",
});

export const blankAsycudaItem = (desc = "", code = ""): AsycudaItem => ({
  desc,
  tariff_code: code,
  cif: "",
  grossWeight: "",
  netWeight: "",
  originCode: "CN",
  itemPkgs: "0",
  suppUnitCode: "",
  suppUnitName: "",
  suppQty: "0",
});

export function prorateAsycudaItems(header: AsycudaHeader, items: AsycudaItem[]): AsycudaItem[] {
  const totalGross = parseFloat(header.totalGrossWeight) || 0;
  const totalCIF = items.reduce((s, it) => s + (parseFloat(it.cif) || 0), 0) || 1;
  return items.map((it) => {
    const cif = parseFloat(it.cif) || 0;
    const proportion = cif / totalCIF;
    const gross = totalGross > 0 && !it.grossWeight ? (totalGross * proportion).toFixed(2) : it.grossWeight;
    const net = gross && !it.netWeight ? (parseFloat(gross) * 0.9).toFixed(2) : it.netWeight;
    return { ...it, grossWeight: gross, netWeight: net };
  });
}

export function generateAsycudaXML(h: AsycudaHeader, items: AsycudaItem[]): string {
  const esc = (s: string) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const n = (tag: string, val: string | number | null | undefined) =>
    val != null && val !== "" ? `<${tag}>${esc(String(val))}</${tag}>` : `<${tag}/>`;
  const nullTag = (tag: string) => `<${tag}><null/></${tag}>`;
  const hsRaw = (code: string) =>
    (code || "").replace(/\./g, "").replace(/[^0-9]/g, "").padEnd(8, "0").slice(0, 8);

  const totalCIF = items.reduce((s, it) => s + (parseFloat(it.cif) || 0), 0);
  const totalPkgs = parseInt(h.totalPackages, 10) || 0;
  const totalWeight = items.reduce((s, it) => s + (parseFloat(it.grossWeight) || 0), 0);

  const itemsXML = items
    .map((it) => {
      const cif = parseFloat(it.cif) || 0;
      const suppQty = parseFloat(it.suppQty) || 0;
      const gross = parseFloat(it.grossWeight) || 0;
      const net = parseFloat(it.netWeight) || 0;
      const docs = Array(20)
        .fill(0)
        .map(
          () =>
            "<Attached_documents>" +
            nullTag("Attached_document_code") +
            nullTag("Attached_document_name") +
            nullTag("Attached_document_reference") +
            nullTag("Attached_document_from_rule") +
            "<Attached_document_date/>" +
            "</Attached_documents>",
        )
        .join("\r\n");
      return (
        "<Item>\r\n" +
        docs +
        "\r\n" +
        "<Packages>\r\n" +
        n("Number_of_packages", it.itemPkgs || 0) +
        "\r\n" +
        n("Marks1_of_packages", h.marksText || "AS ADDRESSED") +
        "\r\n" +
        "<Marks2_of_packages></Marks2_of_packages>\r\n" +
        n("Kind_of_packages_code", h.pkgKind || "CT") +
        "\r\n" +
        n("Kind_of_packages_name", h.pkgKind || "CT") +
        "\r\n" +
        "</Packages>\r\n" +
        "<Tarification>\r\n" +
        nullTag("Tarification_data") +
        "\r\n" +
        "<HScode>\r\n" +
        n("Commodity_code", hsRaw(it.tariff_code)) +
        "\r\n" +
        "<Precision_1>000</Precision_1>\r\n" +
        nullTag("Precision_2") +
        "\r\n" +
        nullTag("Precision_3") +
        "\r\n" +
        nullTag("Precision_4") +
        "\r\n" +
        "</HScode>\r\n" +
        nullTag("Preference_code") +
        "\r\n" +
        "<Extended_customs_procedure>4000</Extended_customs_procedure>\r\n" +
        "<National_customs_procedure>000</National_customs_procedure>\r\n" +
        " <Quota_code>NEW</Quota_code>\r\n" +
        "<Supplementary_unit>\r\n" +
        n("Suppplementary_unit_code", it.suppUnitCode || "") +
        "\r\n" +
        n("Suppplementary_unit_name", it.suppUnitName || "") +
        "\r\n" +
        n("Suppplementary_unit_quantity", suppQty > 0 ? suppQty.toFixed(2) : "0.00") +
        "\r\n" +
        "</Supplementary_unit>\r\n" +
        "<Supplementary_unit>\r\n" +
        "<Suppplementary_unit_code></Suppplementary_unit_code>\r\n" +
        "<Suppplementary_unit_name></Suppplementary_unit_name>\r\n" +
        "<Suppplementary_unit_quantity>0.000</Suppplementary_unit_quantity>\r\n" +
        "</Supplementary_unit>\r\n" +
        n("Item_price", cif.toFixed(2)) +
        "\r\n" +
        nullTag("Valuation_method_code") +
        "\r\n" +
        "<Value_item>0.00+0.00+0.00+0.00-0.00</Value_item>\r\n" +
        "</Tarification>\r\n" +
        "<Goods_description>\r\n" +
        n("Country_of_origin_code", it.originCode || "") +
        "\r\n" +
        "<Country_of_origin_region/>\r\n" +
        n("Commercial_Description", it.desc) +
        "\r\n" +
        "</Goods_description>\r\n" +
        "<Previous_doc>\r\n" +
        n("Summary_declaration", h.summaryDecl || "") +
        "\r\n" +
        "</Previous_doc>\r\n" +
        "<Valuation_item>\r\n" +
        "<Weight_itm>\r\n" +
        n("Gross_weight_itm", gross.toFixed(2)) +
        "\r\n" +
        n("Net_weight_itm", net.toFixed(2)) +
        "\r\n" +
        "</Weight_itm>\r\n" +
        "<Total_cost_itm>0.00</Total_cost_itm>\r\n" +
        n("Total_CIF_itm", cif.toFixed(2)) +
        "\r\n" +
        "<Rate_of_adjustment>1</Rate_of_adjustment>\r\n" +
        n("Statistical_value", cif.toFixed(2)) +
        "\r\n" +
        "<Alpha_coeficient_of_apportionment/>\r\n" +
        "<Item_Invoice>\r\n" +
        n("Amount_national_currency", cif.toFixed(2)) +
        "\r\n" +
        n("Amount_foreign_currency", cif.toFixed(2)) +
        "\r\n" +
        n("Currency_code", h.currencyCode || "TTD") +
        "\r\n" +
        n("Currency_name", h.currencyName || "No foreign currency") +
        "\r\n" +
        n("Currency_rate", h.currencyRate || "1.00") +
        "\r\n" +
        "</Item_Invoice>\r\n" +
        ["item_external_freight", "item_internal_freight", "item_insurance", "item_other_cost", "item_deduction"]
          .map(
            (tag) =>
              "<" +
              tag +
              ">\r\n" +
              "<Amount_national_currency>0.00</Amount_national_currency>\r\n" +
              "<Amount_foreign_currency>0.00</Amount_foreign_currency>\r\n" +
              "<Currency_code><null/></Currency_code>\r\n" +
              "<Currency_name>No foreign currency</Currency_name>\r\n" +
              "<Currency_rate>0</Currency_rate>\r\n" +
              "</" +
              tag +
              ">",
          )
          .join("\r\n") +
        "\r\n" +
        "</Valuation_item>\r\n" +
        "<Taxation>\r\n" +
        Array(9)
          .fill("<Taxation_line/>")
          .join("\r\n") +
        "\r\n</Taxation>\r\n" +
        "</Item>"
      );
    })
    .join("\r\n");

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\r\n' +
    "<ASYCUDA>\r\n" +
    "<Assessment_notice>\r\n" +
    Array(8)
      .fill("<Item_tax_total/>")
      .join("\r\n") +
    "\r\n</Assessment_notice>\r\n" +
    "<Global_taxes>\r\n<Global_tax_item/>\r\n<Global_tax_item/>\r\n<Global_tax_item/>\r\n</Global_taxes>\r\n" +
    "<Property>\r\n" +
    "<Sad_flow>I</Sad_flow>\r\n" +
    "<Forms>\r\n" +
    n("Number_of_the_form", 1) +
    "\r\n" +
    n("Total_number_of_forms", items.length) +
    "\r\n" +
    "</Forms>\r\n" +
    "<Nbers>\r\n" +
    "<Number_of_loading_lists/>\r\n" +
    n("Total_number_of_items", items.length) +
    "\r\n" +
    n("Total_number_of_packages", totalPkgs) +
    "\r\n" +
    "</Nbers>\r\n" +
    "<Place_of_declaration><null/></Place_of_declaration>\r\n" +
    "<Date_of_declaration/>\r\n" +
    "<Selected_page>1</Selected_page>\r\n" +
    "</Property>\r\n" +
    "<Identification>\r\n" +
    "<Office_segment>\r\n" +
    n("Customs_clearance_office_code", h.officeCode || "POS") +
    "\r\n" +
    n("Customs_Clearance_office_name", h.officeName || "Port of Spain") +
    "\r\n" +
    "</Office_segment>\r\n" +
    "<Type>\r\n" +
    n("Type_of_declaration", h.declarationType || "IM") +
    "\r\n" +
    n("Declaration_gen_procedure_code", h.procedureCode || "4") +
    "\r\n" +
    "<Type_of_transit_document><null/></Type_of_transit_document>\r\n" +
    "</Type>\r\n" +
    "<Manifest_reference_number><null/></Manifest_reference_number>\r\n" +
    "<Registration><Serial_number><null/></Serial_number><Number/><Date/></Registration>\r\n" +
    "<Assessment><Serial_number><null/></Serial_number><Number/><Date/></Assessment>\r\n" +
    "<receipt><Serial_number><null/></Serial_number><Number/><Date/></receipt>\r\n" +
    "</Identification>\r\n" +
    "<Traders>\r\n" +
    "<Exporter>\r\n" +
    n("Exporter_code", h.exporterCode || "") +
    "\r\n" +
    n("Exporter_name", h.exporterName) +
    "\r\n" +
    "</Exporter>\r\n" +
    "<Consignee>\r\n" +
    n("Consignee_code", h.consigneeCode) +
    "\r\n" +
    n("Consignee_name", h.consigneeName) +
    "\r\n" +
    "</Consignee>\r\n" +
    "<Financial><Financial_code><null/></Financial_code><Financial_name><null/></Financial_name></Financial>\r\n" +
    "</Traders>\r\n" +
    "<Declarant>\r\n" +
    n("Declarant_code", h.declarantCode || "BR0257") +
    "\r\n" +
    n("Declarant_name", h.declarantName || "MARIO A L GRANADO") +
    "\r\n" +
    "<Reference>" +
    n("Number", h.referenceNumber) +
    "</Reference>\r\n" +
    "</Declarant>\r\n" +
    "<General_information>\r\n" +
    "<Country>\r\n" +
    n("Country_first_destination", h.exportCountryCode || "PA") +
    "\r\n" +
    "<Trading_country>TT</Trading_country>\r\n" +
    "<Export>\r\n" +
    n("Export_country_code", h.exportCountryCode || "PA") +
    "\r\n" +
    n("Export_country_name", h.exportCountryName || "") +
    "\r\n" +
    "<Export_country_region/>\r\n" +
    "</Export>\r\n" +
    "<Destination>\r\n" +
    "<Destination_country_code>TT</Destination_country_code>\r\n" +
    "<Destination_country_name>Trinidad and Tobago</Destination_country_name>\r\n" +
    "<Destination_country_region><null/></Destination_country_region>\r\n" +
    "</Destination>\r\n" +
    n("Country_of_origin_name", h.exportCountryName || "") +
    "\r\n" +
    "</Country>\r\n" +
    "<Value_details>0.00</Value_details>\r\n" +
    "<CAP/>\r\n" +
    "<Additional_information><null/></Additional_information>\r\n" +
    "<Comments_free_text><null/></Comments_free_text>\r\n" +
    "</General_information>\r\n" +
    "<Transport>\r\n" +
    "<Means_of_transport>\r\n" +
    "<Departure_arrival_information>" +
    n("Identity", h.vesselName) +
    n("Nationality", h.vesselNat || "AG") +
    "</Departure_arrival_information>\r\n" +
    "<Border_information>" +
    n("Identity", h.vesselName) +
    "<Nationality><null/></Nationality>" +
    n("Mode", h.transportMode || "1") +
    "</Border_information>\r\n" +
    "<Inland_mode_of_transport><null/></Inland_mode_of_transport>\r\n" +
    "</Means_of_transport>\r\n" +
    n("Container_flag", h.containerFlag || "false") +
    "\r\n" +
    "<Delivery_terms>" +
    n("Code", h.incoterm || "FOB") +
    "<Place><null/></Place><Situation><null/></Situation></Delivery_terms>\r\n" +
    "<Border_office>" +
    n("Code", h.borderOfficeCode || "TTPTS") +
    "<n>" +
    esc(h.borderOfficeName || "Point Lisas") +
    "</n></Border_office>\r\n" +
    "<Place_of_loading><Code><null/></Code><n><null/></n><Country><null/></Country></Place_of_loading>\r\n" +
    "<Location_of_goods><null/></Location_of_goods>\r\n" +
    "</Transport>\r\n" +
    "<Financial>\r\n" +
    "<Financial_transaction><code1/><code2/></Financial_transaction>\r\n" +
    "<Bank><Code>" +
    esc(h.bankCode || "01") +
    "</Code><n><null/></n><Branch><null/></Branch><Reference><null/></Reference></Bank>\r\n" +
    "<Terms><Code>99</Code><Description>Basic</Description></Terms>\r\n" +
    "<Total_invoice/>\r\n" +
    "<Deffered_payment_reference><null/></Deffered_payment_reference>\r\n" +
    n("Mode_of_payment", h.paymentMode || "CASH") +
    "\r\n" +
    "<Amounts><Total_manual_taxes/><Global_taxes></Global_taxes><Totals_taxes></Totals_taxes></Amounts>\r\n" +
    "<Guarantee><n><null/></n><Amount></Amount><Date/><Excluded_country><Code><null/></Code><n><null/></n></Excluded_country></Guarantee>\r\n" +
    "</Financial>\r\n" +
    "<Warehouse><Identification/><Delay/></Warehouse>\r\n" +
    "<Transit><Principal><Code><null/></Code><n><null/></n><Representative><null/></Representative></Principal>" +
    "<Signature><Place><null/></Place><Date/></Signature>" +
    "<Destination><Office><null/></Office><Country><null/></Country></Destination>" +
    "<Seals><Number/><Identity><null/></Identity></Seals>" +
    "<Result_of_control/><Time_limit/><Officer_name><null/></Officer_name></Transit>\r\n" +
    "<Valuation>\r\n" +
    "<Calculation_working_mode>2</Calculation_working_mode>\r\n" +
    "<Weight><Gross_weight/></Weight>\r\n" +
    "<Total_cost>0.00</Total_cost>\r\n" +
    n("Total_CIF", totalCIF.toFixed(2)) +
    "\r\n" +
    "<Gs_Invoice>\r\n" +
    n("Amount_national_currency", totalCIF.toFixed(2)) +
    "\r\n" +
    n("Amount_foreign_currency", totalCIF.toFixed(2)) +
    "\r\n" +
    n("Currency_code", h.currencyCode || "TTD") +
    "\r\n" +
    n("Currency_name", h.currencyName || "No foreign currency") +
    "\r\n" +
    n("Currency_rate", h.currencyRate || "1.00") +
    "\r\n" +
    "</Gs_Invoice>\r\n" +
    ["Gs_external_freight", "Gs_internal_freight", "Gs_insurance", "Gs_other_cost", "Gs_deduction"]
      .map(
        (tag) =>
          "<" +
          tag +
          ">\r\n<Amount_national_currency>0.00</Amount_national_currency>\r\n" +
          "<Amount_foreign_currency>0.00</Amount_foreign_currency>\r\n<Currency_code/>\r\n" +
          "<Currency_name>No foreign currency</Currency_name>\r\n<Currency_rate>1.0</Currency_rate>\r\n</" +
          tag +
          ">",
      )
      .join("\r\n") +
    "\r\n" +
    "<Total>\r\n" +
    n("Total_invoice", totalCIF.toFixed(2)) +
    "\r\n" +
    n("Total_weight", totalWeight.toFixed(3)) +
    "\r\n" +
    "</Total>\r\n" +
    "</Valuation>\r\n" +
    itemsXML +
    "\r\n" +
    "<Suppliers_documents>\r\n" +
    n("Suppliers_document_name", h.exporterName) +
    "\r\n" +
    n("Suppliers_document_country", h.exporterAddress2 || "") +
    "\r\n" +
    n("Suppliers_document_city", h.exporterAddress3 || "") +
    "\r\n" +
    n("Suppliers_document_street", h.exporterAddress4 || "") +
    "\r\n" +
    n("Suppliers_document_type_code", h.invoiceTypeCode || "IV05") +
    "\r\n" +
    n("Suppliers_document_invoice_nbr", h.supplierInvoiceNbr || "") +
    "\r\n" +
    n("Suppliers_document_date", h.supplierInvoiceDate || "0/0/00") +
    "\r\n" +
    "</Suppliers_documents>\r\n" +
    "</ASYCUDA>"
  );
}

export function downloadAsycudaXml(header: AsycudaHeader, items: AsycudaItem[]) {
  const prorated = prorateAsycudaItems(header, items);
  const xml = generateAsycudaXML(header, prorated);
  const ref = header.referenceNumber || "ASYCUDA";
  const blob = new Blob([xml], { type: "application/xml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `DutyDesk_${ref.replace(/[^a-zA-Z0-9_-]/g, "_")}.xml`;
  a.click();
}
